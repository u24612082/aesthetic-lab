import {offlineRequest,prepareOffline,diaryFor,subscribeOffline,offlineStatus,startOfflineSync} from './offline.js';
if(new URLSearchParams(location.search).has('embedded'))document.body.classList.add('embedded');
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number = (n, digits = 0) => new Intl.NumberFormat('en-ZA', {maximumFractionDigits: digits}).format(n);
let zone = 'Africa/Johannesburg', data = null, selectedFood = null, catalogue = [], foodRequestId = null, activeView = 'overview';
let nutritionSettings=null, foodScope='all', catalogueSequence=0, catalogueSearchTimer, diaryLogs=[], editingLog=null;
let coachStatus = null, coachBusy = false, priorKeyConfigured = null;
function localDate() { return new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function fmtDate(day, opts = {day:'numeric', month:'short'}) { return new Intl.DateTimeFormat('en-ZA', opts).format(new Date(day.slice(0,10)+'T12:00:00')); }
function empty(title, text) { return `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`; }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 4500); }
function showPair() { if (!$('#pair-dialog').open) $('#pair-dialog').showModal(); }
async function api(path, options = {}) {
  try{return await offlineRequest(path,options)}
  catch(e){if(e.status===401)showPair();throw e}
}
const post = (path, body, method = 'POST', options = {}) => api(path, {...options, method, body: JSON.stringify(body)});
const titles = {
  overview:['Your aesthetic overview','The details that build the bigger picture.'],
  training:['Every session counts','Your received training history and data coverage.'],
  nutrition:['Fuel your next session','South African staples. Simple gram-based logging.'],
  coach:['See the bigger picture','Evidence, context and a little direction.'],
  sync:['Connected, on your terms','Your Mac is the home of your data.']
};
function navigate(view) {
  if (!titles[view]) return;
  activeView = view;
  $$('.view').forEach(el => el.hidden = el.id !== `view-${view}`);
  $$('.nav').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#page-title').innerHTML = esc(titles[view][0]) + '<span>.</span>';
  $('#page-subtitle').textContent = titles[view][1];
  $('#breadcrumb').innerHTML = `Workspace <b>/</b> ${esc(view === 'sync' ? 'Sync & devices' : view[0].toUpperCase()+view.slice(1))}`;
  $('#period').hidden = view === 'sync' || view === 'nutrition';
  if (view === 'nutrition') loadDiary().catch(err => toast(err.message));
  if (view === 'sync') loadStatus().catch(err => toast(err.message));
  if (view === 'coach') loadCoachStatus().catch(err => toast(err.message));
}
document.addEventListener('click', event => { const button = event.target.closest('[data-view]'); if (button) navigate(button.dataset.view); });
$('#breadcrumb').addEventListener('click', () => navigate('sync'));
function stat(label, value, unit, note, icon) { return `<article class="stat"><div class="stat-top">${esc(label)}<span class="stat-icon">${icon}</span></div><div class="stat-value">${esc(value)}<small>${esc(unit)}</small></div><div class="stat-note">${esc(note)}</div></article>`; }
function sessionRows(workouts) {
  return workouts.length ? workouts.map(w => `<div class="session-row" role="button" tabindex="0" data-session="${w.id}" aria-label="Open ${esc(w.name)}"><div class="session-icon">⌁</div><div><div class="session-title">${esc(w.name)}</div><div class="session-sub">${esc(w.source)} · ${Math.round((new Date(w.ended_at)-new Date(w.started_at))/60000)} min</div></div><span class="session-date">${esc(fmtDate(w.local_date))}</span><span class="tag">${w.detail_level === 'sets' ? 'SET-LEVEL' : 'SUMMARY ONLY'}</span></div>`).join('') : empty('Your next chapter starts here.', 'Choose a routine and complete your first session in the tracker.');
}
function render() {
  if (!data) return;
  const s = data.stats;
  $('#date-range').textContent = `${fmtDate(data.period.start)} — ${fmtDate(data.period.end, {day:'numeric',month:'short',year:'numeric'})}`;
  $('#stats').innerHTML = stat('Training sessions', s.sessions, '', `${s.summary_only} summary-only · ${data.period.days}-day view`, '⌁') + stat('Working sets', s.working_sets, 'sets', `${s.known_hard_sets} confirmed at RIR ≤4`, '▤') + stat('Volume lifted', number(s.tonnage_kg/1000,1), 'tonnes', 'Reported loads × repetitions', '↗') + stat('Food consistency', `${s.logged_days}/${data.period.days}`, 'days', 'Days with at least one food entry', '◉');
  const preferred = ['Upper Chest','Lateral Deltoids','Lats','Upper Back','Quadriceps','Hamstrings'];
  const sorted = preferred.map(t => data.volume.find(g => g.target === t));
  const max = Math.max(...sorted.map(g => g.direct_sets), 1);
  $('#volume-chart').innerHTML = sorted.map((g,i) => `<div class="volume-row" title="${esc(g.target)}: ${g.direct_sets} direct; ${g.secondary_sets} secondary; ${g.unknown_rir_sets} with unknown RIR"><span class="volume-name">${esc(g.target)}</span><div class="volume-track"><div class="volume-fill ${i>1?'alt':''}" style="width:${g.direct_sets/max*100}%"></div></div><span class="volume-count">${g.direct_sets}</span></div>`).join('');
  $('#volume-chart').setAttribute('aria-label', sorted.map(g => `${g.target}: ${g.direct_sets} direct working sets`).join('; '));
  const today = data.daily.find(d => d.date === localDate());
  const hasFood = today && today.food_entries;
  $('#kcal').textContent = hasFood ? number(today.kcal) : '—';
  $('#macros').innerHTML = ['protein','carbs','fat'].map((key,i) => `<div class="macro"><strong>${hasFood?number(today[key],1):'—'}<small> g</small></strong><span>${['Protein','Carbs','Fat'][i]}</span></div>`).join('');
  // Ring segments show macro-derived energy distribution, never an invented calorie goal.
  const svg = $('.nutrition-ring svg');
  svg.querySelectorAll('.macro-segment').forEach(el => el.remove());
  $('#macro-ring').style.strokeDasharray = '0 503';
  if (hasFood) {
    const values = [today.protein*4,today.carbs*4,today.fat*9], total = values.reduce((a,b) => a+b,0);
    let offset = 0;
    values.forEach((value,i) => { const length = total ? value/total*503 : 0; const circle = document.createElementNS('http://www.w3.org/2000/svg','circle'); circle.setAttribute('class','macro-segment'); circle.setAttribute('cx','100');circle.setAttribute('cy','100');circle.setAttribute('r','80');circle.style.stroke = ['#c5e75c','#aabd94','#d4c69b'][i];circle.style.strokeDasharray = `${length} 503`;circle.style.strokeDashoffset = -offset;svg.append(circle);offset += length; });
    svg.setAttribute('aria-label','Macro energy distribution');
  }
  // Aggregate long periods into up to 12 bins; chart remains readable on iPhone.
  const size = Math.ceil(data.daily.length/12), bins = [];
  for (let i=0;i<data.daily.length;i+=size) { const chunk=data.daily.slice(i,i+size); bins.push({date:chunk[0].date, sets:chunk.reduce((a,d)=>a+d.sets,0)}); }
  const peak = Math.max(...bins.map(b => b.sets),1);
  $('#activity-chart').innerHTML = bins.map(b => `<div class="activity-column" title="${esc(b.date)}: ${b.sets} sets${size>1?' across '+size+' days':''}"><div class="activity-bar" style="height:${Math.max(3,b.sets/peak*105)}px"><b>${b.sets || ''}</b></div><span>${fmtDate(b.date, data.daily.length === 7 ? {weekday:'short'} : {day:'numeric',month:'short'})}</span></div>`).join('');
  $('#recent-sessions').innerHTML = sessionRows(data.workouts.slice(0,3));
  $('#all-sessions').innerHTML = sessionRows(data.workouts);
  $('#volume-detail').innerHTML = `<table class="set-table"><thead><tr><th>TARGET</th><th>DIRECT</th><th>SECONDARY</th><th>RIR ≤4</th><th>RIR UNKNOWN</th></tr></thead><tbody>${data.volume.map(g=>`<tr><td>${esc(g.target)}</td><td>${g.direct_sets}</td><td>${g.secondary_sets}</td><td>${g.known_hard_sets}</td><td>${g.unknown_rir_sets}</td></tr>`).join('')}</tbody></table>`;
  $('#methodology').textContent = data.methodology;
  $('#unmapped').textContent = data.unmapped_exercises.length ? `Unmapped movements: ${data.unmapped_exercises.join(', ')}. Add verified aliases in aesthetic_lab/ingest.py to classify them.` : 'All currently received movement names are mapped. Missing set detail cannot be inferred from session summaries.';
  renderCoach();
}
function renderCoach() {
  const gates = data.progression_gates || [];
  $('#technique-gates').innerHTML = gates.length ? gates.map(g => `<div class="gate-row"><div class="gate-title"><strong>${esc(g.exercise)}</strong><span class="gate-status ${g.status}">${g.status==='passed'?'TECHNIQUE PASSED':g.status==='hold'?'HOLD LOAD':'AWAITING EVIDENCE'}</span></div><p>${esc(g.movement_kind)} · ${esc(g.equipment_id || 'Equipment unknown')} · ${esc(g.side)} · ${esc(g.session_date)}</p><ul>${g.reasons.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>`).join('') : empty('Technique evidence comes first.', 'No scored working sets received. Load increases remain on hold until a supported integration supplies real technique scores.');
  const saved = data.coach;
  let report;
  try { report = saved ? JSON.parse(saved.report) : null; } catch { report=null; }
  const mode = saved?.mode === 'claude_pro' ? 'CLAUDE PRO' : saved?.mode === 'claude' ? 'CLAUDE API' : 'LOCAL RULES';
  $('#coach-mode').textContent = mode; $('#report-mode').textContent = mode;
  $('#performance-signals').innerHTML = data.symmetry.length ? `<ul>${data.symmetry.map(s=>`<li>${esc(s.exercise)}: ${s.gap_pct}% paired left/right estimated performance gap. Technique and equipment can affect this comparison.</li>`).join('')}</ul>` : '<p>No paired unilateral performance data yet. Physical symmetry cannot be scored from workout volume.</p>';
  if (!report) { $('#coach-report').innerHTML = empty('No audit saved yet.', 'Connect Claude or generate a local audit once food or workout records are available.'); return; }
  $('#coach-preview').textContent = report.summary;
  $('#coach-headline').textContent = data.stats.working_sets ? 'A closer look at your training.' : 'Good decisions start with good data.';
  const section = (heading, items) => `<h3>${esc(heading)}</h3><ul>${items.map(v=>`<li>${esc(v)}</li>`).join('')}</ul>`;
  $('#coach-report').innerHTML = `<p class="report-summary">${esc(report.summary)}</p><p class="footnote">28-day audit · Generated ${esc(saved.created_at)} UTC · May precede your latest entries</p>` + section('Aesthetic audit',report.aesthetic_audit) + section('Fatigue signals',report.fatigue_signals) + section('Nutrition context',report.nutrition_notes) + section('Volume suggestions',report.adjustments.length ? report.adjustments.map(a=>`${a.target}: ${a.weekly_set_delta>0?'+':''}${a.weekly_set_delta} weekly sets. ${a.reason}`) : ['No volume adjustment proposed. Keep observing before changing your programme.']) + section('Evidence & limitations',report.limitations);
  $('#performance-signals').innerHTML = data.symmetry.length ? `<ul>${data.symmetry.map(s=>`<li>${esc(s.exercise)}: ${s.gap_pct}% paired left/right estimated performance gap. Technique and equipment can affect this comparison.</li>`).join('')}</ul>` : '<p>No paired unilateral performance data yet. Physical symmetry cannot be scored from workout volume.</p>';
}
async function refresh() { if(activeView==='nutrition')await loadDiary();try{data=await api(`/api/dashboard?days=${$('#period').value}`);render();}catch(e){if(activeView!=='nutrition')throw e}await loadCoachStatus().catch(()=>{}); }
function updateCoachButtons() {
  const busy=coachBusy || coachStatus?.state==='running';
  $('#generate-audit').disabled = busy || !coachStatus?.has_data;
  $('#connect-coach').disabled=busy || !!coachStatus?.demo;$('#disconnect-coach').disabled=busy || !!coachStatus?.demo;
  $('#anthropic-key').disabled=!!coachStatus?.demo;
  $('#generate-audit').textContent = coachBusy ? 'Working…' : coachStatus?.api_key_configured && coachStatus?.enabled ? 'Generate Claude audit ↗' : 'Update local audit ↗';
}
async function loadCoachStatus() {
  coachStatus = await api('/api/coach/status');
  const s=coachStatus;
  const labels={subscription:['Your Claude Pro coach','SUBSCRIPTION · NO API'],not_configured:['Claude is not connected','LOCAL RULES'],disabled:['Claude is disabled','DISABLED'],waiting_for_data:['Claude is configured','WAITING FOR DATA'],ready:['Claude is ready','API CONFIGURED'],running:['Your coach is working','WORKING'],error:['The latest AI audit failed','NEEDS ATTENTION']};
  const [title,badge]=labels[s.state] || ['Coach status','CHECK SETTINGS'];
  $('#coach-connection-title').textContent=title;$('#coach-connection-badge').textContent=badge;
  $('#coach-connection-message').textContent=s.demo ? 'Demo mode uses local rules and cannot change your API settings. Connect Claude in your personal workspace on port 8765.' : s.message;
  const coverage={empty:'No food or workout records yet. Log food or finish a workout.',summary_only:'Workout summaries are available; exercise volume and technique cannot be inferred from them.',nutrition_only:'Food data is available. Nutrition can be reviewed while training awaits completed sessions.',detailed:'Exercise-level records are available. Progression still requires measured technique evidence.'};
  $('#coach-data-coverage').textContent=`Last 28 days: ${s.sessions} sessions · ${s.detailed_sessions} detailed · ${s.food_days} food days. ${coverage[s.data_status] || ''}`;
  $('#coach-nav-mode').textContent=s.api_key_configured && s.enabled ? 'AI' : 'LOCAL';
  const subscription=s.provider==='subscription';
  $('#subscription-coach').hidden=!subscription;
  const automation=s.subscription?.automation;const job=automation?.job;
  const running=job?.state==='queued'||job?.state==='running';
  $('#open-subscription-coach').disabled=!!s.demo||running||coachBusy||!s.has_data;
  $('#open-subscription-coach').textContent=running?'Reviewing…':'Review now ↗';
  $('#toggle-auto-coach').disabled=!!s.demo;
  $('#toggle-auto-coach').textContent=automation?.enabled?'Pause automatic reviews':'Enable automatic reviews';
  $('#generate-audit').hidden=subscription&&!s.demo;
  const review=s.subscription?.has_review?(s.subscription.stale?'Saved data changed; an updated review will follow automatically.':'Your saved Claude review matches the current data.'):'No subscription review saved yet.';
  const state=job?.state;
  const issue=state&& !['complete','queued','running','superseded'].includes(state);
  const retry=job?.retry_after&&job.retry_after>Date.now()/1000?' Next retry after '+new Date(job.retry_after*1000).toLocaleTimeString()+'.':'';
  $('#subscription-review-status').textContent=running?'Claude is reviewing your saved data in the background.':issue?job.message+retry:(automation?.enabled?'Automatic reviews enabled. ':'Automatic reviews paused. ')+review;

  $('#coach-setup').hidden=subscription;
  $('#coach-nav-mode').textContent=subscription?'PRO':s.api_key_configured&&s.enabled?'AI':'LOCAL';
  $('#disconnect-coach').hidden=subscription||!s.api_key_configured;
  $('#coach-setup summary').textContent=s.api_key_configured?'Replace Claude API key':'Connect Claude';
  if(priorKeyConfigured!==s.api_key_configured){$('#coach-setup').open=!s.api_key_configured;priorKeyConfigured=s.api_key_configured;}
  $('#coach-error').hidden=!s.last_error;
  $('#coach-error').textContent=s.last_error?.message || '';
  updateCoachButtons();
}
async function generateAudit() {
  if(coachBusy)return;
  coachBusy=true;updateCoachButtons();$('#coach-error').hidden=true;
  try{const result=await post(coachStatus?.provider==='subscription'?'/api/coach/run?force=true':'/api/coach/run',{});await refresh();toast(result.message);}catch(err){$('#coach-error').textContent=err.message;$('#coach-error').hidden=false;}finally{coachBusy=false;updateCoachButtons();}
}
$('#generate-audit').addEventListener('click',generateAudit);
$('#open-subscription-coach').addEventListener('click',generateAudit);
$('#toggle-auto-coach').addEventListener('click',async()=>{try{await post('/api/coach/automation',{enabled:!coachStatus?.subscription?.automation?.enabled});await loadCoachStatus();}catch(err){toast(err.message);}});
setInterval(()=>{if(activeView==='coach'&&!document.hidden&&!$('#pair-dialog').open)refresh().catch(()=>{});},5000);
window.addEventListener('focus',()=>{if(activeView==='coach')refresh().catch(err=>toast(err.message));});
$('#coach-connect-form').addEventListener('submit',async e=>{
  e.preventDefault();if(coachBusy)return;coachBusy=true;updateCoachButtons();$('#coach-error').hidden=true;
  try{const result=await post('/api/coach/connect',{api_key:$('#anthropic-key').value});$('#anthropic-key').value='';await loadCoachStatus();toast(result.message);}catch(err){$('#coach-error').textContent=err.message;$('#coach-error').hidden=false;}finally{$('#anthropic-key').value='';coachBusy=false;updateCoachButtons();}
});
$('#disconnect-coach').addEventListener('click',async()=>{
  if(coachBusy)return;coachBusy=true;updateCoachButtons();
  try{const result=await post('/api/coach/disconnect',{});await post(coachStatus?.provider==='subscription'?'/api/coach/run?force=true':'/api/coach/run',{});await refresh();toast(result.message);}catch(err){$('#coach-error').textContent=err.message;$('#coach-error').hidden=false;}finally{coachBusy=false;updateCoachButtons();}
});
async function loadStatus() {
  const status = await api('/api/status'); zone=status.timezone;
  $('#demo-banner').hidden = !status.demo;
  if(status.tracker_mode==='native'){$('.connection-flow').innerHTML='<span>Workout tracker</span><b>→</b><span>Mac API</span><b>→</b><span>SQLite + coach</span>';$('#view-sync .card-description').textContent='Log sets directly in your tracker. Completed sessions feed analytics and coaching through the same local database.';$('#view-sync > .footnote').textContent='The built-in tracker replaces Liftoff ingestion. Your Mac stores routine drafts, completed sessions, food logs and audits together.';}
  $('#workout-sync-banner').hidden = status.tracker_mode === 'native' || status.demo || status.workouts > 0;
  const sync = status.workout_sync || {};
  const coverage = status.tracker_mode === 'native' ? 'Built-in workout tracker enabled' : sync.state === 'set_data_received' ? 'Exercise sets received' : status.workouts ? 'Workout summaries only' : 'No Liftoff workouts received';
  $('#sync-status').innerHTML = `<div class="notice"><strong>${esc(coverage)}.</strong> ${status.tracker_mode === 'native' ? 'Log sessions directly in your tracker; there is no external account connection to configure.' : !status.workouts ? 'Your browser is paired with this Mac. A Liftoff data connection still needs to be configured and authorized.' : sync.state === 'set_data_received' ? 'These records have reached this Mac; this does not confirm a currently active live connection.' : 'Summaries contain no exercise sets, loads or technique scores. Those details need a supported source integration.'}</div><div class="status-grid"><div><strong>${status.workouts} workouts</strong><p>In this Mac’s database</p></div><div><strong>${status.inbox_enabled?'Enabled':'Not configured'}</strong><p>Automatic iCloud inbox</p></div><div><strong>${status.auto_coach?'Claude enabled':'Local rules'}</strong><p>Background coaching</p></div></div>`;
  $('#sync-events').innerHTML = status.events.length ? status.events.map(e=>`<div class="event-row"><span>${esc(e.transport)}</span><span>${esc(e.status)}</span><div>${esc(e.message)}<small>${esc(e.created_at)} UTC</small></div></div>`).join('') : empty('Waiting for your first sync.', 'Configure the iPhone automation using docs/shortcuts.md.');
}
async function loadNutritionSettings(){
  nutritionSettings=await api('/api/nutrition/settings');
  $('#catalogue-credit').textContent=`${number(nutritionSettings.food_count)} foods available offline · USDA reference + South African products. Match raw/cooked state and edible weight. Verify branded estimates against the pack.`;
  const chosen=$('#food-category').value;
  $('#food-category').innerHTML='<option value="">All categories</option>'+nutritionSettings.categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  $('#food-category').value=chosen;
}
async function loadDiary() {
  if(!nutritionSettings)await loadNutritionSettings();
  const day=$('#diary-date').value||localDate();
  const diary=await diaryFor(day);
  const d=diary.totals,targets=diary.settings.targets;
  diaryLogs=diary.logs;
  const goal=targets.kcal,remaining=goal==null?null:goal-d.kcal,pct=goal?Math.min(100,d.kcal/goal*100):0;
  $('#diary-stats').innerHTML=`<div class="energy-card"><div><div class="eyebrow">CALORIES LOGGED</div><div class="energy-number">${number(d.kcal)} <small>kcal</small></div><p>${remaining==null?'Set a daily target to see calories remaining':remaining>=0?`${number(remaining)} kcal remaining`:`${number(-remaining)} kcal above your target`}</p><span class="nutrition-badge">${diaryLogs.length} food entries · manually logged</span></div><div class="calorie-ring" style="--progress:${pct}%"><span>${goal?number(goal):'—'}<small>${goal?'daily target':'no target set'}</small></span></div></div><div class="macro-cards">`+
  ['protein','carbs','fat'].map((k,i)=>`<div class="macro-card macro-${k}"><span>${['Protein','Carbs','Fat'][i]}</span><strong>${number(d[k],1)}<small> g${targets[k]?` / ${number(targets[k])}`:''}</small></strong><div class="macro-track"><i style="width:${targets[k]?Math.min(100,d[k]/targets[k]*100):0}%"></i></div></div>`).join('')+'</div>';
  $('#food-diary').innerHTML=['Breakfast','Lunch','Dinner','Snacks'].map((meal,i)=>{
    const logs=diaryLogs.filter(l=>l.meal===meal);
    return `<section class="meal-card"><div class="meal-heading"><div><span class="meal-icon">${['☀','◐','☾','✦'][i]}</span><h3>${meal}</h3><small>${number(logs.reduce((n,l)=>n+l.kcal,0))} kcal</small></div><button class="text-button" data-add-meal="${meal}">＋ Add food</button></div>${logs.length?logs.map(l=>`<div class="food-row"><div>${esc(l.food_name)}<small>${number(l.grams,1)} g · P ${number(l.protein,1)} / C ${number(l.carbs,1)} / F ${number(l.fat,1)}</small></div><strong>${number(l.kcal)}<small> kcal</small></strong><div class="diary-row-actions"><button class="icon-button" data-edit-log="${l.id}" aria-label="Edit ${esc(l.food_name)}">✎</button><button class="icon-button" data-repeat-log="${l.id}" aria-label="Repeat ${esc(l.food_name)}">＋</button><button class="icon-button" data-delete-log="${l.id}" aria-label="Remove ${esc(l.food_name)}">×</button></div></div>`).join(''):`<p class="meal-empty">Nothing logged yet</p>`}</section>`;
  }).join('');
}
async function openFood(meal) {
  editingLog=null;selectedFood=null;$$('[data-food-tab]').forEach(b=>b.disabled=false);$('#food-back').hidden=false;
  $('#food-error').textContent='';$('#log-form').hidden=true;$('#food-filter').value='';$('#food-category').value='';foodScope='all';
  $('#save-food-log').textContent='Add to diary ↗';
  $('#log-date').value=$('#diary-date').value||localDate();
  if(typeof meal==='string')$('#log-form').elements.meal.value=meal;
  foodTab('catalogue');$('#food-dialog').showModal();
  try{if(!nutritionSettings)await loadNutritionSettings();await loadCatalogue();$('#food-filter').focus();}catch(err){$('#food-error').textContent=err.message;}
}
async function loadCatalogue() {
  const sequence=++catalogueSequence;
  const q=$('#food-filter').value,category=$('#food-category').value;
  const result=await api(`/api/foods?q=${encodeURIComponent(q)}&view=${foodScope}&category=${encodeURIComponent(category)}`);
  if(sequence!==catalogueSequence)return;
  catalogue=result;renderFoodOptions();
}
function renderFoodOptions() {
  $$('[data-food-scope]').forEach(b=>b.classList.toggle('active',b.dataset.foodScope===foodScope));
  $('#food-result-count').textContent=`${catalogue.length===60?'Top 60':catalogue.length} matches · ${number(nutritionSettings?.food_count||0)} foods in your library`;
  $('#food-options').innerHTML=catalogue.map(f=>`<div class="food-search-row"><button class="food-option" data-food-id="${f.id}"><span>${esc(f.name)}<small>${esc(f.brand)} · ${esc(f.basis)} · ${f.verified?'Corrected label':f.brand==='USDA reference'?'Reference data':'Estimate'}</small></span><span>${number(f.kcal)}<small>kcal / 100 g</small></span></button><button type="button" class="food-favorite" data-favorite-food="${f.id}" aria-label="${f.favorite?'Unfavorite':'Favorite'} ${esc(f.name)}" aria-pressed="${f.favorite}">${f.favorite?'★':'☆'}</button></div>`).join('')||empty('No matches.','Try another name, another tab, a South African barcode or add a pack label.');
}
function foodTab(tab) { ['catalogue','search','label'].forEach(t=>{$(`#food-${t}`).hidden=t!==tab;});$$('[data-food-tab]').forEach(b=>b.classList.toggle('active',b.dataset.foodTab===tab));$('#log-form').hidden=true;$('#food-error').textContent='';if(tab==='label'){$('#label-form').reset();$('#edit-food-id').value='';} }
function selectFood(food) {
  selectedFood=food;foodRequestId=null;
  ['catalogue','search','label'].forEach(t=>$(`#food-${t}`).hidden=true);
  $('#log-form').hidden=false;
  $('#food-back').hidden=!!editingLog;$$('[data-food-tab]').forEach(b=>b.disabled=!!editingLog);
  $('#selected-food').innerHTML=`<strong>${esc(food.name)}</strong><p>${esc(food.brand)} · ${esc(food.basis)}</p><p class="footnote">${esc(food.provenance)}</p>${editingLog?'':'<button type="button" id="edit-selected" class="text-button">Verify / correct pack label ↗</button>'}`;
  const portions=food.portions||[];
  $('#portion-select').innerHTML='<option value="">Weighed in grams</option>'+portions.map((p,i)=>`<option value="${i}">${esc(p.label)} · ${number(p.grams,1)} g</option>`).join('');
  $('#portion-count').value='1';$('#portion-count-wrap').hidden=!portions.length;
  $('#portion-select').value=portions.length?'0':'';
  $('#grams').value=portions[0]?.grams||100;updateFoodPreview();$('#grams').focus();
}
function updateFoodPreview() { if(!selectedFood)return;const ratio=Number($('#grams').value)/100;$('#food-preview').innerHTML=`<strong>${number(selectedFood.kcal*ratio)} kcal</strong><span>Protein ${number(selectedFood.protein*ratio,1)} g</span><span>Carbs ${number(selectedFood.carbs*ratio,1)} g</span><span>Fat ${number(selectedFood.fat*ratio,1)} g</span>`; }
function applyPortion(){const portion=(selectedFood?.portions||[])[$('#portion-select').value];$('#portion-count-wrap').hidden=!portion;if(portion)$('#grams').value=Math.round(portion.grams*Number($('#portion-count').value)*10)/10;foodRequestId=null;updateFoodPreview();}
$('#portion-select').addEventListener('change',applyPortion);
$('#portion-count').addEventListener('input',applyPortion);
$('#food-back').addEventListener('click',()=>{foodTab('catalogue');loadCatalogue().catch(e=>toast(e.message));});
$$('[data-food-scope]').forEach(b=>b.addEventListener('click',()=>{foodScope=b.dataset.foodScope;loadCatalogue().catch(e=>toast(e.message));}));
$('#food-category').addEventListener('change',()=>loadCatalogue().catch(e=>toast(e.message)));
$('#nutrition-goals').addEventListener('click',async()=>{if(!nutritionSettings)await loadNutritionSettings();Object.entries(nutritionSettings.targets).forEach(([k,v])=>{$('#nutrition-target-form').elements[k].value=v??'';});$('#nutrition-goal-dialog').showModal();});
$('#goals-close').addEventListener('click',()=>$('#nutrition-goal-dialog').close());
$('#nutrition-target-form').addEventListener('submit',async e=>{e.preventDefault();try{const targets=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,v===''?null:Number(v)]));await post('/api/nutrition/settings',targets,'PUT');await loadNutritionSettings();await loadDiary();$('#nutrition-goal-dialog').close();}catch(err){$('#goal-error').textContent=err.message;}});
for(const [id,delta] of [['diary-prev',-1],['diary-next',1]])$(('#'+id)).addEventListener('click',()=>{const d=new Date(($('#diary-date').value||localDate())+'T12:00:00');d.setDate(d.getDate()+delta);$('#diary-date').value=d.toLocaleDateString('en-CA');loadDiary().catch(e=>toast(e.message));});
$('#food-diary').addEventListener('click',async e=>{
  const add=e.target.closest('[data-add-meal]');if(add){openFood(add.dataset.addMeal);return;}
  const edit=e.target.closest('[data-edit-log]'),repeat=e.target.closest('[data-repeat-log]');
  if(!edit&&!repeat)return;
  const log=diaryLogs.find(l=>l.id===Number(edit?.dataset.editLog||repeat?.dataset.repeatLog));if(!log)return;
  try{
    if(repeat){await post('/api/food-logs',{food_id:log.food_id,grams:log.grams,meal:log.meal,local_date:$('#diary-date').value,request_id:crypto.randomUUID()});await loadDiary();return;}
    await openFood(log.meal);editingLog=log;
    selectFood({id:log.food_id,name:log.food_name,brand:'Saved diary entry',basis:'per 100 g of original entry',provenance:'Editing preserves the original nutrition snapshot.',...Object.fromEntries(['kcal','protein','carbs','fat'].map(k=>[k,log[k]/log.grams*100]))});
    $('#grams').value=log.grams;$('#log-date').value=log.local_date;$('#save-food-log').textContent='Save changes';updateFoodPreview();
  }catch(err){toast(err.message);}
});
$('#food-filter').addEventListener('input',()=>{clearTimeout(catalogueSearchTimer);catalogueSearchTimer=setTimeout(()=>loadCatalogue().catch(e=>toast(e.message)),150);});
$('#grams').addEventListener('input',()=>{$('#portion-select').value='';$('#portion-count-wrap').hidden=true;updateFoodPreview();});
$('#log-form').addEventListener('input',()=>foodRequestId=null);
$$('[data-food-tab]').forEach(b=>b.addEventListener('click',()=>foodTab(b.dataset.foodTab)));
$('#food-options').addEventListener('click',async e=>{const fav=e.target.closest('[data-favorite-food]');if(fav){const f=catalogue.find(x=>x.id===Number(fav.dataset.favoriteFood));try{await post(`/api/foods/${f.id}/favorite`,{favorite:!f.favorite},'PATCH');await loadCatalogue();}catch(err){toast(err.message);}return;}const b=e.target.closest('[data-food-id]');if(b)selectFood(catalogue.find(f=>f.id===Number(b.dataset.foodId)));});
$('#selected-food').addEventListener('click',e=>{if(e.target.id!=='edit-selected')return;const f=selectedFood;foodTab('label');$('#edit-food-id').value=f.id;Object.entries(f).forEach(([k,v])=>{const input=$('#label-form').elements.namedItem(k);if(input)input.value=v;});});
$('#label-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.submitter || e.target.querySelector('button:not([type="button"])');button.disabled=true;
  try{const body=Object.fromEntries(new FormData(e.target));['kcal','protein','carbs','fat'].forEach(k=>body[k]=Number(body[k]));const id=$('#edit-food-id').value;const result=await post(id?`/api/foods/${id}`:'/api/foods',body,id?'PATCH':'POST');await loadCatalogue();selectFood(await api(`/api/foods/${result.id}`));toast('Pack label saved.');}catch(err){$('#food-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#log-form').addEventListener('submit',async e=>{
  e.preventDefault();if(!selectedFood)return;const button=e.submitter || e.target.querySelector('button:not([type="button"])');button.disabled=true;
  try{const body=Object.fromEntries(new FormData(e.target));body.grams=Number(body.grams);if(editingLog){await post(`/api/food-logs/${editingLog.id}`,body,'PATCH',{entryRequestId:editingLog.request_id,entryBase:editingLog});}else{body.food_id=selectedFood.id;body.request_id=foodRequestId ||= crypto.randomUUID();await post('/api/food-logs',body);}$('#food-dialog').close();toast('Food added to your diary.');await refresh();}catch(err){$('#food-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#off-search-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=e.submitter || e.target.querySelector('button:not([type="button"])');button.disabled=true;$('#food-error').textContent='';$('#off-results').innerHTML=empty('Searching South Africa…','');
  try{const q=$('#off-query').value.trim();if(/^\d{8,14}$/.test(q)){const f=await post(`/api/foods/barcode/${q}`,{});await loadCatalogue();selectFood(f);}else{const results=await api(`/api/foods/search/za?q=${encodeURIComponent(q)}`);$('#off-results').innerHTML=results.length?results.map(f=>`<button class="food-option" data-barcode="${esc(f.barcode)}"><span>${esc(f.name)}<small>${esc(f.brand)} · ${esc(f.barcode)}</small></span><span>Register ＋</span></button>`).join(''):empty('No complete South African products found.','Try the barcode or add the pack label.');}}catch(err){$('#off-results').innerHTML='';$('#food-error').textContent=err.message;}finally{button.disabled=false;}
});
$('#off-results').addEventListener('click',async e=>{const b=e.target.closest('[data-barcode]');if(!b)return;b.disabled=true;try{const f=await post(`/api/foods/barcode/${encodeURIComponent(b.dataset.barcode)}`,{});await loadCatalogue();selectFood(f);}catch(err){$('#food-error').textContent=err.message;}finally{b.disabled=false;}});
document.addEventListener('click',async e=>{
  const del=e.target.closest('[data-delete-log]');if(del){del.disabled=true;try{await api(`/api/food-logs/${del.dataset.deleteLog}`,{method:'DELETE'});await refresh();toast('Food entry removed.');}catch(err){toast(err.message);del.disabled=false;}}
  const session=e.target.closest('[data-session]');if(session)openSession(session.dataset.session);
});
document.addEventListener('keydown',e=>{const s=e.target.closest('[data-session]');if(s && (e.key==='Enter'||e.key===' ')){e.preventDefault();openSession(s.dataset.session);}});
async function openSession(id) {
  try{const {workout:w,sets}=await api(`/api/workouts/${id}`);$('#session-detail').innerHTML=`<h3>${esc(w.name)}</h3><p>${fmtDate(w.local_date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>`+(sets.length?`<div class="session-table-wrap"><table class="set-table"><thead><tr><th>MOVEMENT / TARGET</th><th>KG</th><th>REPS</th><th>RIR</th><th>SIDE</th></tr></thead><tbody>${sets.map(s=>`<tr><td>${esc(s.exercise)}<br><small>${esc(s.target)}${s.warmup?' · Warmup':''}</small></td><td>${number(s.load_kg,1)}</td><td>${s.reps}</td><td>${s.rir ?? '—'}</td><td>${esc(s.side)}</td></tr>`).join('')}</tbody></table></div>`:empty('Summary received.','This HealthKit record contains no exercise sets. No volume or fatigue data has been inferred.'));$('#session-dialog').showModal();}catch(err){toast(err.message);}
}
$('#pair-form').addEventListener('submit',async e=>{e.preventDefault();const button=e.submitter || e.target.querySelector('button:not([type="button"])');button.disabled=true;try{await post('/api/login',{token:new FormData(e.target).get('token')});$('#pair-dialog').close();$('#pair-form').reset();$('#pair-error').textContent='';await loadStatus();await refresh();toast('Device paired. Welcome to your workspace.');}catch(err){$('#pair-error').textContent=err.message;}finally{button.disabled=false;}});
$('#pair-close').onclick=()=>$('#pair-dialog').close();
$('#pair-button').onclick=showPair;$('#show-pair').onclick=showPair;
$('#logout').onclick=async()=>{try{await post('/api/logout',{});location.reload();}catch(err){toast(err.message);}};
$('#food-close').onclick=()=>$('#food-dialog').close();$('#session-close').onclick=()=>$('#session-dialog').close();
$('#open-food').onclick=openFood;$('#diary-add').onclick=openFood;
$('#diary-date').value=localDate();$('#diary-date').addEventListener('change',()=>loadDiary().catch(err=>toast(err.message)));
$('#period').addEventListener('change',()=>refresh().catch(err=>toast(err.message)));
window.addEventListener('online',()=>refresh().catch(()=>{}));window.addEventListener('offline',()=>$('#offline-banner').hidden=false);
// The root service worker also caches this embedded food diary.
async function boot(){void prepareOffline().catch(()=>{});if(titles[location.hash.slice(1)])navigate(location.hash.slice(1));try{await loadStatus();await refresh();}catch(err){if(!$('#pair-dialog').open)toast(err.message);}}
boot();
setInterval(()=>{if(!document.hidden&&!$('#pair-dialog').open)refresh().catch(()=>{});},60000);

startOfflineSync();
subscribeOffline(async()=>{const s=await offlineStatus();$('#offline-banner').hidden=!s.pending;$('#offline-banner').textContent=s.pending?`${s.pending} food changes saved on this device. ${s.conflicts.length?'Review the sync conflict in the tracker.':'Syncs when the Mac is reachable and the app is open.'}`:'';if(activeView==='nutrition')loadDiary().catch(()=>{});});
