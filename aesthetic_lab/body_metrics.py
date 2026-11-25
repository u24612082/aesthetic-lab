"""Measured body mass from tracker records; no physique or body-fat inference."""
import json
import math
from datetime import date,datetime,timedelta
from statistics import mean
from .config import timezone
from .db import connect


def body_metrics(days=28,end=None,state=None):
    end=end or datetime.now(timezone()).date()
    if state is None:
        with connect() as c:row=c.execute('SELECT payload FROM tracker_state WHERE id=1').fetchone()
        state=json.loads(row['payload']) if row else {}
    daily={};ignored=0
    for row in state.get('bodyweight',[]):
        try:
            day=date.fromisoformat(row['d']);weight=float(row['w'])
            if not math.isfinite(weight) or not 20<=weight<=400 or day>end:raise ValueError()
            stamp=float(row.get('t') or 0)
            if day not in daily or stamp>=daily[day]['_t']:daily[day]={'date':str(day),'kg':weight,'_t':stamp}
        except (ValueError,TypeError,KeyError,OverflowError):ignored+=1
    records=[{'date':r['date'],'kg':r['kg']} for _,r in sorted(daily.items())]
    current=[r for r in records if str(end-timedelta(days=6))<=r['date']<=str(end)]
    previous=[r for r in records if str(end-timedelta(days=13))<=r['date']<str(end-timedelta(days=6))]
    recent=mean(r['kg'] for r in current) if current else None
    earlier=mean(r['kg'] for r in previous) if previous else None
    weekly=None
    if len(current)>=3 and len(previous)>=3:
        gap=mean(date.fromisoformat(r['date']).toordinal() for r in current)-mean(date.fromisoformat(r['date']).toordinal() for r in previous)
        if gap>=4:weekly=(recent-earlier)*7/gap
    goal=state.get('targetW')
    if not isinstance(goal,(float,int)) or isinstance(goal,bool) or not math.isfinite(goal) or not 20<=goal<=400:goal=None
    return {'unit':'kg','latest':records[-1] if records else None,'goal_kg':goal,
            'records':[r for r in records if r['date']>=str(end-timedelta(days=max(days,28)-1))][-365:],
            'mean_7d_kg':round(recent,3) if recent is not None else None,
            'previous_mean_7d_kg':round(earlier,3) if earlier is not None else None,
            'change_kg_per_week':round(weekly,4) if weekly is not None else None,
            'change_pct_per_week':round(weekly/earlier*100,4) if weekly is not None else None,
            'weigh_ins_current_week':len(current),'weigh_ins_previous_week':len(previous),
            'ignored_records':ignored,'limitations':'Scale-weight trends include water and glycogen; they do not measure fat or muscle change.'}
