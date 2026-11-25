import asyncio
import hashlib
import hmac
import ipaddress
import json
import os
import time
import subprocess
import sys
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.gzip import GZipMiddleware

from . import foods
from .coaching import CoachError, coach_status, connect_claude, disconnect_claude, run_coach
from .analytics import dashboard
from .config import token
from .db import connect, event, initialize
from .ingest import RevisionConflict, ingest
from .models import CoachConnection, FoodInput, FoodLogInput, IngestBatch, Login
from .worker import background_worker
from .tracker import router as tracker_router
from .subscription import connection_status as subscription_status
from . import auto_coach
from .models import CoachAutomation
from .models import FoodFavorite,FoodLogEdit,NutritionTargets,NutritionDay
from . import nutrition_plan
from . import phone


def cookie_value():
    return hmac.new(token().encode(), b"aesthetic-lab-session-v1", hashlib.sha256).hexdigest()


@asynccontextmanager
async def lifespan(app):
    token()
    initialize()
    task = asyncio.create_task(background_worker())
    yield
    auto_coach.cancel_running()
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Aesthetic Lab", version="0.1.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
hosts = list({"localhost", "127.0.0.1", *os.getenv("APP_HOSTS", "").split(","), *os.getenv("APP_BIND", "127.0.0.1").split(",") } - {""})
app.add_middleware(TrustedHostMiddleware, allowed_hosts=hosts)
app.add_middleware(GZipMiddleware,minimum_size=1500)
attempts = defaultdict(deque)


@app.exception_handler(RequestValidationError)
async def private_credential_errors(request, exc):
    if request.url.path == "/api/coach/connect":
        return JSONResponse({"detail":"Enter an Anthropic API key in the connection form."},status_code=422)
    return await request_validation_exception_handler(request,exc)


@app.exception_handler(CoachError)
async def coaching_error(request, exc):
    status = 429 if exc.code == "cooldown" else 409 if exc.code in ("busy","demo") else 422 if exc.code in ("invalid_key","subscription") else 502
    return JSONResponse({"detail":str(exc),"code":exc.code},status_code=status)


@app.middleware("http")
async def protect(request: Request, call_next):
    if request.method in ("POST", "PATCH", "PUT", "DELETE"):
        origin = request.headers.get("origin")
        if origin and origin != f"{request.url.scheme}://{request.headers.get('host')}":
            return JSONResponse({"detail": "Cross-origin write rejected"}, status_code=403)
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 2_000_000:
                return JSONResponse({"detail": "Payload exceeds 2 MB"}, status_code=413)
        request._body = bytes(body)
    path = request.url.path
    if path.startswith("/api/") and path not in ("/api/health", "/api/login"):
        bearer = request.headers.get("authorization", "")
        valid = hmac.compare_digest(bearer.encode(), ("Bearer " + token()).encode()) or hmac.compare_digest(request.cookies.get("lab_session", "").encode(), cookie_value().encode())
        if not valid:
            return JSONResponse({"detail": "Pair this device to continue"}, status_code=401)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    ancestors = "'self'" if path.startswith('/analytics/') else "'none'"
    response.headers["Content-Security-Policy"] = f"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors {ancestors}; base-uri 'self'; form-action 'self'"
    if path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"status": "ok", "schema_version": 1}


@app.post("/api/login")
def login(body: Login, request: Request, response: Response):
    host = request.client.host if request.client else "unknown"
    queue = attempts[host]
    now = time.monotonic()
    while queue and queue[0] < now - 60:
        queue.popleft()
    if len(queue) >= 8:
        raise HTTPException(429, "Too many pairing attempts. Wait a minute.")
    queue.append(now)
    if not hmac.compare_digest(body.token.encode(), token().encode()) and not phone.consume_pairing_code(body.token):
        raise HTTPException(401, "Pairing code or token is incorrect or expired")
    response.set_cookie("lab_session", cookie_value(), httponly=True, secure=request.url.scheme == "https", samesite="strict", max_age=30*86400)
    return {"paired": True}


@app.get('/api/phone/status')
def phone_status():return phone.settings()


@app.post('/api/phone/pairing-code')
def phone_pairing_code():return phone.create_pairing_code()


@app.get('/api/phone/profile')
def phone_profile():
    profile=Path(__file__).resolve().parent.parent/'certs/iphone.mobileconfig'
    if not profile.exists():raise HTTPException(404,'Run Setup iPhone Access.command on the Mac first.')
    return FileResponse(profile,media_type='application/x-apple-aspen-config',filename='Aesthetic-Lab-iPhone.mobileconfig')


@app.post('/api/phone/reveal-profile')
def reveal_phone_profile():
    profile=Path(__file__).resolve().parent.parent/'certs/iphone.mobileconfig'
    if sys.platform!='darwin' or not profile.exists():raise HTTPException(409,'Run Setup iPhone Access.command on your Mac first.')
    if os.getenv('APP_DEMO','false').lower()=='true':raise HTTPException(409,'Use your personal Mac workspace for phone setup.')
    subprocess.Popen(['/usr/bin/open','-R',str(profile)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    return {'message':'In Finder, right-click iphone.mobileconfig, choose Share → AirDrop, and send it to your own iPhone.'}


@app.get('/api/phone/qr.svg')
def phone_qr():
    current=phone.settings()
    if not current['url']:raise HTTPException(404,'Phone access is not configured yet.')
    return Response(phone.qr_svg(current['url']),media_type='image/svg+xml')


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie("lab_session")
    return {"paired": False}


@app.get("/api/schema")
def schema():
    return IngestBatch.model_json_schema()


@app.post("/api/ingest/workouts")
def ingest_workouts(body: IngestBatch):
    try:
        result = ingest(body)
    except RevisionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    event("https", "ok", json.dumps(result))
    return result


@app.get("/api/dashboard")
def get_dashboard(days: int = Query(default=7, ge=7, le=84), end: date | None = None):
    return dashboard(days, end)


@app.get("/api/workouts/{workout_id}")
def workout_detail(workout_id: int):
    with connect() as c:
        workout = c.execute("SELECT * FROM workouts WHERE id=?", (workout_id,)).fetchone()
        if not workout:
            raise HTTPException(404, "Workout not found")
        return {"workout": dict(workout), "sets": [dict(s) for s in c.execute("SELECT * FROM exercise_sets WHERE workout_id=? ORDER BY ordinal", (workout_id,))]}


@app.get("/api/status")
def status():
    with connect() as c:
        events = [dict(r) for r in c.execute("SELECT * FROM sync_events ORDER BY id DESC LIMIT 15")]
        total = c.execute("SELECT COUNT(*) FROM workouts").fetchone()[0]
        detailed = c.execute("SELECT COUNT(*) FROM workouts WHERE detail_level='sets'").fetchone()[0]
        last_import = c.execute("SELECT created_at FROM sync_events WHERE transport IN ('https','icloud') AND status='ok' ORDER BY id DESC LIMIT 1").fetchone()
    return {"workouts": total, "demo": os.getenv("APP_DEMO", "false").lower() == "true", "inbox_enabled": bool(os.getenv("APP_INBOX")),
            "tracker_mode":os.getenv('APP_TRACKER_MODE','native'),
            "workout_sync": {"state": "no_data_received" if not total else "set_data_received" if detailed else "summaries_received",
                             "received_workouts": total, "detailed_workouts": detailed,
                             "last_received_at": last_import["created_at"] if last_import else None},
            "auto_coach": os.getenv("AUTO_COACH", "false").lower() == "true" and bool(os.getenv("ANTHROPIC_API_KEY")),
            "subscription_auto": auto_coach.enabled(),
            "events": events, "timezone": os.getenv("APP_TIMEZONE", "Africa/Johannesburg")}


@app.get("/api/foods")
def list_foods(q: str = Query(default='',max_length=100), view: str=Query(default='all',pattern='^(all|favorites|recent|plan)$'),category: str=Query(default='',max_length=100)):
    return foods.local_search(q,view,category)


@app.get('/api/nutrition/settings')
def nutrition_settings():
    with connect() as c:
        row=c.execute('SELECT kcal,protein,carbs,fat FROM nutrition_settings WHERE id=1').fetchone()
        count=c.execute('SELECT COUNT(*) FROM foods').fetchone()[0]
        categories=[r[0] for r in c.execute('SELECT DISTINCT category FROM foods ORDER BY category')]
    return {'targets':dict(row) if row else {k:None for k in ('kcal','protein','carbs','fat')},'food_count':count,'categories':categories}


@app.put('/api/nutrition/settings')
def update_nutrition_settings(body:NutritionTargets):
    with connect() as c:
        c.execute('INSERT OR REPLACE INTO nutrition_settings(id,kcal,protein,carbs,fat) VALUES (1,?,?,?,?)',tuple(body.model_dump().values()))
        nutrition_plan.pause_for_manual_targets(c)
    return {'saved':True}


@app.get('/api/nutrition/plan')
def get_nutrition_plan():
    data=dashboard(28)
    return nutrition_plan.plan_status(training=data)


@app.put('/api/nutrition/plan')
def save_nutrition_plan(body:nutrition_plan.PlanProfile):
    return nutrition_plan.configure(body)


@app.put('/api/nutrition/day')
def set_nutrition_day(body:NutritionDay):
    with connect() as c:c.execute('INSERT OR REPLACE INTO nutrition_days(local_date,complete) VALUES(?,?)',(str(body.local_date),body.complete))
    return {'saved':True}


@app.get('/api/foods/discover')
async def discover_foods(q:str=Query(min_length=2,max_length=100)):
    return await foods.discover(q)


@app.get('/api/foods/{food_id:int}')
def get_food(food_id:int):
    with connect() as c:row=c.execute('SELECT * FROM foods WHERE id=?',(food_id,)).fetchone()
    if not row:raise HTTPException(404,'Food not found')
    return foods.serialise(row)


@app.patch('/api/foods/{food_id}/favorite')
def favorite_food(food_id:int,body:FoodFavorite):
    with connect() as c:
        if not c.execute('UPDATE foods SET favorite=? WHERE id=?',(body.favorite,food_id)).rowcount:raise HTTPException(404,'Food not found')
    return {'favorite':body.favorite}


@app.get("/api/coach/status")
def get_coach_status():
    result=coach_status()
    if result['provider']=='subscription':
        result['subscription']={**subscription_status(),'automation':auto_coach.status()}
    return result


@app.post('/api/coach/open-subscription')
def open_subscription_coach():
    if os.getenv('APP_DEMO','false').lower()=='true':raise HTTPException(409,'Open your personal workspace to launch Claude Code.')
    return auto_coach.request_review()


@app.post('/api/coach/automation')
def configure_automation(body: CoachAutomation):
    if os.getenv('APP_DEMO','false').lower()=='true':raise HTTPException(409,'Demo settings cannot change personal automation.')
    from .coaching import save_settings
    save_settings({'CLAUDE_AUTO_COACH':'true' if body.enabled else 'false'})
    return auto_coach.status()


@app.post("/api/coach/connect")
def configure_coach(body: CoachConnection):
    return connect_claude(body.api_key.get_secret_value())


@app.post("/api/coach/disconnect")
def disable_coach():
    return disconnect_claude()


@app.post("/api/coach/run")
def generate_coach_report(force: bool = False):
    if os.getenv('COACH_PROVIDER')=='subscription' and os.getenv('APP_DEMO','false').lower()!='true':
        return auto_coach.request_review(force=force)
    return run_coach()


@app.post("/api/foods", status_code=201)
def add_food(body: FoodInput):
    with connect() as c:
        food_id = c.execute("""INSERT INTO foods(name,brand,kcal,protein,carbs,fat,basis,provenance,verified)
            VALUES (?,?,?,?,?,?,?,'User supplied pack label',1)""", (*body.model_dump().values(),)).lastrowid
    return {"id": food_id}


@app.patch("/api/foods/{food_id}")
def edit_food(food_id: int, body: FoodInput):
    with connect() as c:
        result = c.execute("""UPDATE foods SET name=?,brand=?,kcal=?,protein=?,carbs=?,fat=?,basis=?,
            provenance='User supplied pack label',verified=1 WHERE id=?""", (*body.model_dump().values(), food_id))
        if not result.rowcount:
            raise HTTPException(404, "Food not found")
    return {"id": food_id}


@app.get("/api/foods/search/za")
async def search_za(q: str = Query(min_length=2, max_length=100)):
    return await foods.search(q)


@app.post("/api/foods/barcode/{code}")
async def import_barcode(code: str):
    if not code.isdigit() or len(code) not in (8, 12, 13, 14):
        raise HTTPException(422, "Use an 8, 12, 13 or 14 digit barcode")
    p = await foods.barcode(code)
    with connect() as c:
        c.execute("""INSERT INTO foods(barcode,name,brand,kcal,protein,carbs,fat,basis,provenance,verified,source_url)
            VALUES (:barcode,:name,:brand,:kcal,:protein,:carbs,:fat,:basis,:provenance,:verified,:source_url)
            ON CONFLICT(barcode) DO NOTHING""", p)
        food = c.execute("SELECT * FROM foods WHERE barcode=?", (code,)).fetchone()
    return foods.serialise(food)


@app.post("/api/food-logs", status_code=201)
def log_food(body: FoodLogInput):
    with connect() as c:
        c.execute("BEGIN IMMEDIATE")
        old = c.execute("SELECT * FROM food_logs WHERE request_id=?", (body.request_id,)).fetchone()
        if old:
            if (old["food_id"], old["local_date"], old["meal"], old["grams"]) != (body.food_id, body.local_date.isoformat(), body.meal, body.grams):
                raise HTTPException(409, "This request ID already belongs to another entry")
            return {"id": old["id"], "unchanged": True}
        food = c.execute("SELECT * FROM foods WHERE id=?", (body.food_id,)).fetchone()
        if not food:
            raise HTTPException(404, "Food not found")
        # Snapshot nutrient totals so future catalogue edits do not rewrite history.
        values = tuple(food[k]*body.grams/100 for k in ("kcal", "protein", "carbs", "fat"))
        log_id = c.execute("""INSERT INTO food_logs(request_id,food_id,local_date,meal,grams,food_name,kcal,protein,carbs,fat)
            VALUES (?,?,?,?,?,?,?,?,?,?)""", (body.request_id, body.food_id, body.local_date.isoformat(), body.meal, body.grams, food["name"], *values)).lastrowid
    return {"id": log_id}


@app.delete("/api/food-logs/{log_id}")
def delete_log(log_id: int):
    with connect() as c:
        c.execute("DELETE FROM food_logs WHERE id=?", (log_id,))
    return {"deleted": True}


@app.patch('/api/food-logs/{log_id}')
def edit_food_log(log_id:int,body:FoodLogEdit):
    with connect() as c:
        c.execute('BEGIN IMMEDIATE')
        old=c.execute('SELECT * FROM food_logs WHERE id=?',(log_id,)).fetchone()
        if not old:raise HTTPException(404,'Food entry not found')
        ratio=body.grams/old['grams']
        c.execute('UPDATE food_logs SET grams=?,meal=?,local_date=?,kcal=?,protein=?,carbs=?,fat=? WHERE id=?',
                  (body.grams,body.meal,str(body.local_date),*(old[k]*ratio for k in ('kcal','protein','carbs','fat')),log_id))
    return {'saved':True}


@app.get('/api/offline/snapshot')
def offline_snapshot():
    from datetime import timedelta
    from .analytics import today
    with connect() as c:
        c.execute('BEGIN')
        library=[foods.serialise(r) for r in c.execute('SELECT * FROM foods')]
        logs=[dict(r) for r in c.execute('SELECT * FROM food_logs WHERE local_date>=?',(str(today()-timedelta(days=90)),))]
        days=[dict(r) for r in c.execute('SELECT * FROM nutrition_days')]
    return {'foods':library,'logs':logs,'nutrition_days':days,'nutrition_plan':get_nutrition_plan(),'coach_status':get_coach_status(),
            'settings':nutrition_settings(),'dashboard':dashboard(7),'status':status()}


@app.get('/api/offline/diary')
def offline_diary():
    from datetime import timedelta
    from .analytics import today
    with connect() as c:
        c.execute('BEGIN')
        logs=[dict(r) for r in c.execute('SELECT * FROM food_logs WHERE local_date>=?',(str(today()-timedelta(days=90)),))]
        plan_keys=tuple(foods.plan_food_rules())
        updates=[foods.serialise(r) for r in c.execute(
            'SELECT * FROM foods WHERE verified=1 OR seed_key IS NULL OR seed_key IN ('+','.join('?' for _ in plan_keys)+')',plan_keys)]
        favorites=[r[0] for r in c.execute('SELECT id FROM foods WHERE favorite=1')]
        days=[dict(r) for r in c.execute('SELECT * FROM nutrition_days')]
    return {'logs':logs,'foods':updates,'favorites':favorites,'nutrition_days':days,'settings':nutrition_settings()}


from .offline import Change as OfflineChange,replay as replay_offline
from pydantic import ValidationError

@app.put('/api/offline/changes/{change_id}')
def replay_phone_change(change_id:str,body:OfflineChange):
    try:return replay_offline(change_id,body)
    except ValidationError:raise HTTPException(422,'Check the pending food change: use valid grams, dates, meals and nutrition values.') from None


@app.get("/api/openapi.json")
def openapi_document():
    return app.openapi()


app.include_router(tracker_router)


@app.get('/api/source')
def source_archive():
    from .config import ROOT
    archive=ROOT/'dist/aesthetic-lab-source.zip'
    if not archive.exists(): raise HTTPException(503,'Source archive is being prepared. The complete source is in your workspace.')
    return FileResponse(archive,filename='aesthetic-lab-source.zip',media_type='application/zip')

app.mount('/exercise-media',StaticFiles(directory=Path(__file__).parent/'exercise_media'),name='exercise-media')
app.mount("/analytics", StaticFiles(directory=Path(__file__).parent / "static", html=True), name="analytics")
tracker_files = Path(__file__).parent / 'opengym_static'
app.mount("/", StaticFiles(directory=tracker_files if tracker_files.exists() else Path(__file__).parent/'static',html=True), name="pwa")
