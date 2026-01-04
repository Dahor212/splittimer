// SplitTimer PWA (no build tools). Data stored locally in localStorage.
// Features: routes, checkpoints, GPX import (profile), ride timer, results, leaderboard, export/import.

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const SCREENS = {
  source: $('#screenSource'),
  routes: $('#screenRoutes'),
  route: $('#screenRouteDetail'),
  ride: $('#screenRide'),
};

const state = {
  screen: 'routes',
  source: null, // 'Zwift' | 'Kinomap'

  currentRouteId: null,
  ride: null, // {routeId, startMs, running, marks:[{cpId, ms}], stoppedMs}
};

const STORAGE_KEY = 'splittimer:data:v1';
const SOURCE_KEY = 'splittimer:source:v1';

function nowMs(){ return performance.now(); }
function pad2(n){ return String(n).padStart(2,'0'); }
function formatTime(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}
function formatSigned(ms){
  const sign = ms < 0 ? '-' : '+';
  return sign + formatTimeShort(Math.abs(ms));
}

function formatTimeShort(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const h = Math.floor(s/3600);
  const m = Math.floor((s%3600)/60);
  const sec = s%60;
  return h>0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}
function formatKm(km){
  if (km === null || km === undefined || Number.isNaN(km)) return '';
  const v = Math.round(km*10)/10;
  return `${v.toFixed(v % 1 === 0 ? 0 : 1)} km`;
}

function uid(){ return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36)+Math.random().toString(36).slice(2)); }

function loadData(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw){
    // seed example like the mockup
    const exampleRouteId = uid();
    const data = {
      routes: [{
        id: exampleRouteId,
        name: 'Alpská Výzva',
        source: 'Zwift',
        totalDistanceKm: 25.6,
        totalAscentM: 840,
        checkpoints: [
          {id: uid(), name:'Start', distanceKm:0},
          {id: uid(), name:'Stoupání', distanceKm:5.2},
          {id: uid(), name:'Vrchol', distanceKm:12.8},
          {id: uid(), name:'Sjezd', distanceKm:18.0},
          {id: uid(), name:'Cíl', distanceKm:25.6},
        ],
        profile: []
      }],
      rides: []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return data;
  }
  return JSON.parse(raw);
}
function saveData(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }


function loadSource(){
  const s = localStorage.getItem(SOURCE_KEY);
  return (s === 'Zwift' || s === 'Kinomap') ? s : null;
}
function saveSource(s){
  localStorage.setItem(SOURCE_KEY, s);
  state.source = s;
  const lbl = $('#currentSourceLabel');
  if (lbl) lbl.textContent = s ?? '—';
}

let data = loadData();

// Migration: ensure every route has source
(function migrate(){
  let changed = false;
  for (const r of data.routes){
    if (r.source !== 'Zwift' && r.source !== 'Kinomap'){
      r.source = state.source || 'Zwift';
      changed = true;
    }
    if (!('totalAscentM' in r)) { r.totalAscentM = null; changed = true; }
    if (!Array.isArray(r.profile)) { r.profile = []; changed = true; }
    if (!Array.isArray(r.checkpoints)) { r.checkpoints = []; changed = true; }
  }
  if (changed) saveData();
})();


// ---------- Navigation ----------
function setTopbar(title, showBack){
  $('#topTitle').textContent = title;
  $('#btnBack').hidden = !showBack;
}
function showScreen(name){
  state.screen = name;
  for (const [k, el] of Object.entries(SCREENS)){
    el.hidden = (k !== name);
  }
  if (name === 'source'){
    setTopbar('Vyber zdroj', false);
    updateSourceUi();
  }
  if (name === 'routes'){
    setTopbar('Moje Trasy', false);
    renderRoutes();
  }
  if (name === 'route'){
    setTopbar(getCurrentRoute()?.name ?? 'Trať', true);
    renderRouteDetail();
  }
  if (name === 'ride'){
    setTopbar(`Jízda: ${getCurrentRoute()?.name ?? ''}`.trim(), true);
    renderRide();
  }
}

$('#btnBack').addEventListener('click', ()=>{
  if (state.screen === 'source'){
    return;
  }
  if (state.screen === 'ride'){
    // back to route detail
    showScreen('route');
  } else if (state.screen === 'route'){
    showScreen('routes');
  }
});

// Menu
$('#btnMenu').addEventListener('click', ()=> { updateSourceUi(); openModal('modalMenu'); });

function updateSourceUi(){
  const s = state.source ?? loadSource();
  const lbl = $('#currentSourceLabel');
  if (lbl) lbl.textContent = s ?? '—';
}

$('#btnPickZwift')?.addEventListener('click', ()=>{
  saveSource('Zwift');
  showScreen('routes');
});
$('#btnPickKinomap')?.addEventListener('click', ()=>{
  saveSource('Kinomap');
  showScreen('routes');
});

$('#btnSwitchSource')?.addEventListener('click', ()=>{
  closeModal('modalMenu');
  showScreen('source');
});

$('#btnCloseMenu').addEventListener('click', ()=> closeModal('modalMenu'));

// Close modals by backdrop
$$('.backdrop').forEach(b=>{
  b.addEventListener('click', (e)=>{
    const id = e.target.getAttribute('data-close');
    if (id) closeModal(id);
  });
});
$$('[data-close]').forEach(btn=>{
  const id = btn.getAttribute('data-close');
  if (btn.classList.contains('backdrop')) return;
  btn.addEventListener('click', ()=> closeModal(id));
});

function openModal(id){ $('#'+id).hidden = false; }
function closeModal(id){ $('#'+id).hidden = true; }

// ---------- Routes list ----------
$('#btnCreateRoute').addEventListener('click', ()=>{
  $('#newRouteName').value = '';
  $('#newRouteDistance').value = '';
  $('#newRouteSource').value = state.source || 'Zwift';
  openModal('modalCreateRoute');
});
$('#btnCreateRouteConfirm').addEventListener('click', ()=>{
  const name = $('#newRouteName').value.trim();
  if (!name) return alert('Zadej název tratě.');
  const dist = parseFloat(String($('#newRouteDistance').value).replace(',','.'));
  const source = ($('#newRouteSource')?.value) || state.source || 'Zwift';
  const route = {
    id: uid(),
    source,
    name,
    totalDistanceKm: Number.isFinite(dist) ? dist : null,
    totalAscentM: null,
    checkpoints: [],
    profile: []
  };
  data.routes.unshift(route);
  saveData();
  closeModal('modalCreateRoute');
  renderRoutes();
});

function renderRoutes(){
  const list = $('#routesList');
  list.innerHTML = '';
  if (!data.routes.length){
    list.innerHTML = `<div class="pad"><div class="hint">Zatím nemáš žádné tratě. Vytvoř si první.</div></div>`;
    return;
  }
  data.routes.filter(r=>!state.source || r.source===state.source).forEach(route=>{
    const count = data.rides.filter(r=>r.routeId===route.id).length;
    const distText = route.totalDistanceKm ? `Délka: ${String(route.totalDistanceKm).replace('.',',')} km` : `Délka: —`;
    const el = document.createElement('div');
    el.className = 'route-item';
    el.innerHTML = `
      <div>
        <div class="name">${escapeHtml(route.name)}</div>
        <div class="sub">${distText} &nbsp;|&nbsp; ${count} záznamů</div>
      </div>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;
    el.addEventListener('click', ()=>{
      state.currentRouteId = route.id;
      showScreen('route');
    });
    list.appendChild(el);
  });
}

$('#btnHistoryAll').addEventListener('click', ()=>{
  showLeaderboard(null);
});

// ---------- Route detail ----------
function getCurrentRoute(){
  return data.routes.find(r=>r.id===state.currentRouteId) || null;
}
function updateRoute(route){
  const idx = data.routes.findIndex(r=>r.id===route.id);
  if (idx>=0){
    data.routes[idx] = route;
    saveData();
  }
}

function renderRouteDetail(){
  const route = getCurrentRoute();
  if (!route){ showScreen('routes'); return; }

  // meta
  const dist = route.totalDistanceKm ? `${String(route.totalDistanceKm).replace('.',',')} km` : '—';
  const asc = route.totalAscentM ? `${Math.round(route.totalAscentM)} m` : '—';
  $('#routeMeta').innerHTML = `Délka: <b>${dist}</b> &nbsp;|&nbsp; Převýšení: <b>${asc}</b>`;

  // checkpoints
  const cpList = $('#checkpointList');
  cpList.innerHTML = '';
  if (!route.checkpoints.length){
    cpList.innerHTML = `<div class="hint">Přidej checkpointy (vrchol, sjezd, zatáčka…). Za jízdy se budou brát v pořadí.</div>`;
  } else {
    route.checkpoints.forEach((cp, idx)=>{
      const el = document.createElement('div');
      el.className = 'cp';
      const distText = (cp.distanceKm ?? cp.distanceKm === 0) ? formatKm(cp.distanceKm) : '';
      el.innerHTML = `
        <div class="dot" style="background:${idx===0?'#2aa36c':(idx===route.checkpoints.length-1?'#d64545':'#2a6fb8')}"></div>
        <div class="name">${escapeHtml(cp.name)}</div>
        <div class="dist">${distText}</div>
        <div class="actions">
          <button class="small-btn" data-act="up">↑</button>
          <button class="small-btn" data-act="down">↓</button>
          <button class="small-btn danger" data-act="del">Smazat</button>
        </div>
      `;
      el.querySelectorAll('button').forEach(btn=>{
        btn.addEventListener('click', (e)=>{
          e.stopPropagation();
          const act = btn.getAttribute('data-act');
          if (act==='del'){
            if (!confirm('Smazat checkpoint?')) return;
            route.checkpoints = route.checkpoints.filter(x=>x.id!==cp.id);
            updateRoute(route);
            renderRouteDetail();
            return;
          }
          const i = route.checkpoints.findIndex(x=>x.id===cp.id);
          if (act==='up' && i>0){
            const tmp = route.checkpoints[i-1]; route.checkpoints[i-1]=route.checkpoints[i]; route.checkpoints[i]=tmp;
            updateRoute(route); renderRouteDetail(); return;
          }
          if (act==='down' && i<route.checkpoints.length-1){
            const tmp = route.checkpoints[i+1]; route.checkpoints[i+1]=route.checkpoints[i]; route.checkpoints[i]=tmp;
            updateRoute(route); renderRouteDetail(); return;
          }
        });
      });
      cpList.appendChild(el);
    });
  }

  // profile
  drawProfile(route);
}

$('#btnAddCheckpoint').addEventListener('click', ()=>{
  $('#cpName').value = '';
  $('#cpDistance').value = '';
  openModal('modalAddCheckpoint');
});
$('#btnAddCheckpointConfirm').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route) return;
  const name = $('#cpName').value.trim();
  if (!name) return alert('Zadej název checkpointu.');
  const dist = parseFloat(String($('#cpDistance').value).replace(',','.'));
  route.checkpoints.push({
    id: uid(),
    name,
    distanceKm: Number.isFinite(dist) ? dist : null
  });
  updateRoute(route);
  closeModal('modalAddCheckpoint');
  renderRouteDetail();
});

$('#btnImportGpx').addEventListener('click', ()=> openModal('modalImportGpx'));
$('#fileGpx').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const text = await file.text();
    const parsed = parseGpx(text);
    const route = getCurrentRoute(); if (!route) return;

    route.profile = downsampleProfile(parsed.profile, 350);
    route.totalDistanceKm = round2(parsed.totalDistanceKm);
    route.totalAscentM = Math.round(parsed.totalAscentM);

    // If there is no Start/Cíl, suggest them (don't overwrite user's checkpoints)
    if (route.checkpoints.length === 0){
      route.checkpoints = [
        {id: uid(), name:'Start', distanceKm:0},
        {id: uid(), name:'Vrchol', distanceKm: round2(route.totalDistanceKm*0.5)},
        {id: uid(), name:'Cíl', distanceKm: route.totalDistanceKm}
      ];
    }

    updateRoute(route);
    closeModal('modalImportGpx');
    renderRouteDetail();
    alert('GPX import hotový ✅');
  }catch(err){
    console.error(err);
    alert('Nepodařilo se importovat GPX. Zkus jiný soubor.');
  } finally {
    $('#fileGpx').value = '';
  }
});

$('#btnEditRoute').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route) return;
  $('#editRouteSource').value = route.source || (state.source||'Zwift');
  $('#editRouteName').value = route.name;
  $('#editRouteDistance').value = route.totalDistanceKm ?? '';
  openModal('modalEditRoute');
});
$('#btnEditRouteSave').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route) return;
  const name = $('#editRouteName').value.trim();
  if (!name) return alert('Zadej název.');
  const dist = parseFloat(String($('#editRouteDistance').value).replace(',','.'));
  route.source = ($('#editRouteSource')?.value) || route.source || (state.source||'Zwift');
  route.name = name;
  route.totalDistanceKm = Number.isFinite(dist) ? dist : route.totalDistanceKm;
  updateRoute(route);
  closeModal('modalEditRoute');
  // update topbar title
  setTopbar(route.name, true);
  renderRoutes();
  if (route.source !== state.source){
    state.currentRouteId = null;
    showScreen('routes');
  } else {
    renderRouteDetail();
  }
});
$('#btnDeleteRoute').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route) return;
  if (!confirm('Opravdu smazat celou trať včetně historie jízd?')) return;
  data.routes = data.routes.filter(r=>r.id!==route.id);
  data.rides = data.rides.filter(r=>r.routeId!==route.id);
  saveData();
  closeModal('modalEditRoute');
  state.currentRouteId = null;
  showScreen('routes');
});

$('#btnStartRide').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route) return;
  if (!route.checkpoints.length){
    alert('Trať nemá žádné checkpointy. Přidej je nejdřív.');
    return;
  }
  startRide(route.id);
  showScreen('ride');
});

$('#btnRouteLeaderboard').addEventListener('click', ()=>{
  showLeaderboard(state.currentRouteId);
});

$('#btnSegmentLeaderboard').addEventListener('click', ()=>{
  showSegmentLeaderboard();
});


// ---------- Stats helpers (leaderboards for checkpoints / finish) ----------
function getRidesForRoute(routeId){
  return data.rides.filter(r=>r.routeId===routeId);
}
function getCheckpointLeaderboard(route, cpIndex){
  const rides = getRidesForRoute(route.id);
  const out = [];
  for (const r of rides){
    if (!Array.isArray(r.marks)) continue;
    if (r.marks.length > cpIndex){
      const t = r.marks[cpIndex]?.elapsedMs;
      if (Number.isFinite(t)) out.push({t, dateIso:r.dateIso, rideId:r.id});
    }
  }
  out.sort((a,b)=>a.t-b.t);
  return out;
}
function getFinishLeaderboard(route){
  return getRidesForRoute(route.id)
    .filter(r=>Number.isFinite(r.totalMs))
    .map(r=>({t:r.totalMs, dateIso:r.dateIso, rideId:r.id}))
    .sort((a,b)=>a.t-b.t);
}
function formatDateShort(iso){
  try{
    const d = new Date(iso);
    return d.toLocaleDateString('cs-CZ', {day:'2-digit', month:'2-digit', year:'numeric'});
  }catch{ return '—';}
}
function computeRank(sortedTimes, elapsed){
  // sortedTimes: [{t,...}] ascending
  let pos = 1;
  for (let i=0;i<sortedTimes.length;i++){
    if (elapsed <= sortedTimes[i].t) { pos = i+1; return {pos, total: sortedTimes.length+1}; }
  }
  return {pos: sortedTimes.length+1, total: sortedTimes.length+1};
}
function deltaToBest(sortedTimes, elapsed){
  if (!sortedTimes.length) return null;
  return elapsed - sortedTimes[0].t; // positive => behind
}

function pickTvTarget(sortedTimes, currentElapsed){
  if (!sortedTimes.length) return null;
  for (let i=0;i<sortedTimes.length;i++){
    if (sortedTimes[i].t >= currentElapsed){
      return {rank: i+1, t: sortedTimes[i].t, dateIso: sortedTimes[i].dateIso};
    }
  }
  const last = sortedTimes[sortedTimes.length-1];
  return {rank: sortedTimes.length, t: last.t, dateIso: last.dateIso, behindLast:true};
}

// ---------- Ride logic ----------
let raf = null;

function startRide(routeId){
  state.ride = {
    routeId,
    startMs: nowMs(),
    running: true,
    marks: [], // {checkpointId, elapsedMs}
    stoppedMs: null,
    lastRankCp: null,
    visual: { segIdx: 0, segStartMs: 0, offsetPx: 0 }
  };
  $('#btnSaveRide').disabled = true;
  try{ const r=getCurrentRoute(); if(r) resetDuelForRide(r);}catch(e){}
  $('#rideNote').value = '';
  $('#rideRunnerName').value = '';

  tick();
}

function tick(){
  if (!state.ride) return;
  if (state.ride.running){
    const elapsed = nowMs() - state.ride.startMs;
    $('#rideTimer').textContent = formatTime(elapsed);
  } else if (state.ride.stoppedMs != null){
    $('#rideTimer').textContent = formatTime(state.ride.stoppedMs);
  }
  try{
    if (state.screen==='ride'){
      const route = getCurrentRoute();
      if (route) updateDuelPositions(route);
    }
  }catch(e){}
  raf = requestAnimationFrame(tick);
}

function stopRide(){
  if (!state.ride) return;
  if (!state.ride.running) return;
  state.ride.running = false;
  state.ride.stoppedMs = nowMs() - state.ride.startMs;
  $('#btnSaveRide').disabled = false;

  // Finish rank toast (TV)
  try{
    const route = getCurrentRoute();
    if (route){
      const finLb = getFinishLeaderboard(route);
      const total = state.ride.stoppedMs;
      const rankInfo = computeRank(finLb, total);
      const dBest = deltaToBest(finLb, total);
      const deltaTxt = (dBest==null) ? '—' : (dBest<=0 ? `-${formatTimeShort(Math.abs(dBest))} před #1` : `+${formatTimeShort(dBest)} za #1`);
      showToast(`Cíl: <b>${formatTimeShort(total)}</b><small>Umístění v cíli: #${rankInfo.pos}/${rankInfo.total} • ${deltaTxt}</small>`, 3200);
    }
  }catch(e){}
}

function rideNextCheckpoint(){
  const route = getCurrentRoute();
  if (!route || !state.ride || !state.ride.running) return;
  const idx = state.ride.marks.length;
  if (idx >= route.checkpoints.length) return;
  const cp = route.checkpoints[idx];
  const elapsed = nowMs() - state.ride.startMs;
  state.ride.marks.push({ checkpointId: cp.id, elapsedMs: elapsed });

  // TV update: rank at this checkpoint
  const lb = getCheckpointLeaderboard(route, idx);
  const rankInfo = computeRank(lb, elapsed);
  const dBest = deltaToBest(lb, elapsed);
  const prevRank = state.ride.lastRankCp;
  state.ride.lastRankCp = rankInfo.pos;

  const deltaTxt = (dBest==null) ? '—' : (dBest<=0 ? `-${formatTimeShort(Math.abs(dBest))} před #1` : `+${formatTimeShort(dBest)} za #1`);
  const changeTxt = (prevRank==null) ? '' : (rankInfo.pos>prevRank ? ` • propad na #${rankInfo.pos}` : (rankInfo.pos<prevRank ? ` • posun na #${rankInfo.pos}` : ` • držíš #${rankInfo.pos}`));

  showToast(
    `${escapeHtml(cp.name)}: <b>${formatTimeShort(elapsed)}</b><small>Umístění na CP: #${rankInfo.pos}/${rankInfo.total}${changeTxt} • ${deltaTxt}</small>`,
    2600
  );

  renderRide();
}

function rideUndo(){
  if (!state.ride) return;
  state.ride.marks.pop();
  renderRide();
}

function renderRide(){
  const route = getCurrentRoute();
  if (!route || !state.ride) return;

  $('#rideRouteName').textContent = `Jízda: ${route.name}`;
  const nextIdx = state.ride.marks.length;
  const nextName = (nextIdx < route.checkpoints.length) ? route.checkpoints[nextIdx].name : '—';
  $('#rideNextLabel').textContent = `Další: ${nextName}`;

  // Marks display
  const box = $('#rideMarks');
  box.innerHTML = '';
  if (!state.ride.marks.length){
    box.innerHTML = `<div class="hint">Stiskni „Další Checkpoint“ při průjezdu bodem.</div>`;
  } else {
    state.ride.marks.forEach((m, i)=>{
      const cp = route.checkpoints[i];
      const prev = i===0 ? 0 : state.ride.marks[i-1].elapsedMs;
      const split = m.elapsedMs - prev;
      const el = document.createElement('div');
      el.className = 'mark';
      el.innerHTML = `
        <div class="left">
          <div class="t">${escapeHtml(cp?.name ?? 'Checkpoint')}</div>
          <div class="sub">Split: ${formatTimeShort(split)}</div>
        </div>
        <div class="time">${formatTimeShort(m.elapsedMs)}</div>
      `;
      box.appendChild(el);
    });
  }

  
  // Comparison (best + TV target) for next checkpoint and finish
  try{
    const elapsedNow = state.ride.running ? (nowMs() - state.ride.startMs) : (state.ride.stoppedMs ?? 0);

    const nextIdx2 = state.ride.marks.length; // upcoming checkpoint index
    const cpLb = (nextIdx2 < route.checkpoints.length) ? getCheckpointLeaderboard(route, nextIdx2) : [];
    const finLb = getFinishLeaderboard(route);

    const bestCp = cpLb.length ? cpLb[0].t : null;
    const bestFin = finLb.length ? finLb[0].t : null;

    $('#cmpNextTitle').textContent = nextIdx2 < route.checkpoints.length
      ? `Další: ${route.checkpoints[nextIdx2].name}`
      : 'Další checkpoint';

    $('#cmpNextBest').textContent = bestCp!=null
      ? `Best CP: ${formatSigned(bestCp - elapsedNow)}`
      : 'Best CP: —';

    $('#cmpFinishBest').textContent = bestFin!=null
      ? `Best Cíl: ${formatSigned(bestFin - elapsedNow)}`
      : 'Best Cíl: —';

    const tvCp = (nextIdx2 < route.checkpoints.length) ? pickTvTarget(cpLb, elapsedNow) : null;
    if (tvCp){
      const rem = tvCp.t - elapsedNow;
      const date = formatDateShort(tvCp.dateIso);
      const tag = tvCp.behindLast ? 'za posledním' : `#${tvCp.rank}`;
      $('#cmpNextTarget').textContent = `Cíl CP (${tag}, ${date}): ${formatSigned(rem)}`;
    } else {
      $('#cmpNextTarget').textContent = 'Cíl CP: —';
    }

    const tvFin = pickTvTarget(finLb, elapsedNow);
    if (tvFin){
      const rem = tvFin.t - elapsedNow;
      const date = formatDateShort(tvFin.dateIso);
      const tag = tvFin.behindLast ? 'za posledním' : `#${tvFin.rank}`;
      $('#cmpFinishTarget').textContent = `Cíl Cíl (${tag}, ${date}): ${formatSigned(rem)}`;
    } else {
      $('#cmpFinishTarget').textContent = 'Cíl Cíl: —';
    }

    $('#compareMode').textContent = state.source ? state.source : '—';
  }catch(e){
    // ignore
  }

    // Duel track update
  try{ updateDuelPositions(route); }catch(e){}

  // Button enable states
  $('#btnNextCheckpoint').disabled = !state.ride.running || (state.ride.marks.length >= route.checkpoints.length);
  $('#btnUndo').disabled = !state.ride.marks.length;
}

$('#btnNextCheckpoint').addEventListener('click', rideNextCheckpoint);
$('#btnUndo').addEventListener('click', rideUndo);
$('#btnStopRide').addEventListener('click', ()=>{
  stopRide();
  renderRide();
  openSaveRide();
});
$('#btnSaveRide').addEventListener('click', openSaveRide);

function openSaveRide(){
  if (!state.ride) return;
  if (state.ride.running){
    // stop first
    stopRide();
  }
  const route = getCurrentRoute(); if (!route) return;
  const total = state.ride.stoppedMs ?? (nowMs()-state.ride.startMs);
  const marks = state.ride.marks;

  const lines = [];
  lines.push(`<b>Trať:</b> ${escapeHtml(route.name)}`);
  lines.push(`<b>Čas:</b> ${formatTimeShort(total)}`);
  if (marks.length){
    const last = marks[marks.length-1].elapsedMs;
    lines.push(`<b>Checkpointy:</b> ${marks.length}/${route.checkpoints.length} (poslední ${formatTimeShort(last)})`);
  }
  $('#saveRideSummary').innerHTML = lines.join('<br/>');
  if (!$('#rideRunnerName').value){
    $('#rideRunnerName').value = `Pokus ${new Date().toLocaleDateString('cs-CZ')}`;
  }
  openModal('modalSaveRide');
}

$('#btnSaveRideConfirm').addEventListener('click', ()=>{
  const route = getCurrentRoute(); if (!route || !state.ride) return;
  const total = state.ride.stoppedMs ?? (nowMs()-state.ride.startMs);

  // Store ride
  const ride = {
    id: uid(),
    routeId: route.id,
    dateIso: new Date().toISOString(),
    totalMs: Math.round(total),
    marks: state.ride.marks.map(m=>({ checkpointId: m.checkpointId, elapsedMs: Math.round(m.elapsedMs) })),
    runnerName: ($('#rideRunnerName').value || '').trim() || null,
    note: $('#rideNote').value.trim() || null,
  };
  data.rides.unshift(ride);
  saveData();

  closeModal('modalSaveRide');

  // cleanup
  state.ride = null;
  if (raf) cancelAnimationFrame(raf);
  raf = null;

  // back to route detail
  showScreen('route');
  alert('Uloženo ✅');
});

// ---------- Leaderboard ----------
function showSegmentLeaderboard(){
  const route = getCurrentRoute();
  if (!route) return;
  const body = $('#segBody');
  body.innerHTML = '';
  $('#segTitle').textContent = `Žebříček checkpointů – ${route.name}`;
  $('#segHint').textContent = 'Top 5 pro každý checkpoint (a cíl). Každý záznam = „závodník“ (název pokusu nebo datum).';

  // For each checkpoint index
  route.checkpoints.forEach((cp, idx)=>{
    const lb = getCheckpointLeaderboard(route, idx);
    const card = document.createElement('div');
    card.className = 'seg-card';
    card.innerHTML = `<div class="h">${escapeHtml(cp.name)} (CP${idx+1})</div>`;
    if (!lb.length){
      card.innerHTML += `<div class="hint">Zatím žádné záznamy.</div>`;
    } else {
      lb.slice(0,5).forEach((row, i)=>{
        const ride = data.rides.find(r=>r.id===row.rideId);
        const who = ride?.runnerName ? escapeHtml(ride.runnerName) : formatDateShort(row.dateIso);
        const note = ride?.note ? escapeHtml(ride.note) : '—';
        const div = document.createElement('div');
        div.className = 'seg-row';
        div.innerHTML = `<div class="seg-rank">#${i+1}</div><div class="seg-name">${who}<span class="seg-sub">${note}</span></div><div class="seg-time">${formatTimeShort(row.t)}</div>`;
        card.appendChild(div);
      });
    }
    body.appendChild(card);
  });

  // Finish
  const fin = getFinishLeaderboard(route);
  const card = document.createElement('div');
  card.className = 'seg-card';
  card.innerHTML = `<div class="h">Cíl</div>`;
  if (!fin.length){
    card.innerHTML += `<div class="hint">Zatím žádné záznamy.</div>`;
  } else {
    fin.slice(0,5).forEach((row, i)=>{
      const ride = data.rides.find(r=>r.id===row.rideId);
      const who = ride?.runnerName ? escapeHtml(ride.runnerName) : formatDateShort(row.dateIso);
      const note = ride?.note ? escapeHtml(ride.note) : '—';
      const div = document.createElement('div');
      div.className = 'seg-row';
      div.innerHTML = `<div class="seg-rank">#${i+1}</div><div class="seg-name">${who}<span class="seg-sub">${note}</span></div><div class="seg-time">${formatTimeShort(row.t)}</div>`;
      card.appendChild(div);
    });
  }
  body.appendChild(card);

  openModal('modalSegmentLeaderboard');
}

function showLeaderboard(routeIdOrNull){
  const list = $('#leaderList');
  list.innerHTML = '';

  let rides = data.rides.slice();
  // Filter by selected source (Zwift/Kinomap)
  if (state.source){
    const routeIds = new Set(data.routes.filter(r=>r.source===state.source).map(r=>r.id));
    rides = rides.filter(r=>routeIds.has(r.routeId));
  }
  let title = 'Historie & Žebříček';
  let hint = 'Seřazeno podle celkového času (nejrychlejší nahoře).';

  if (routeIdOrNull){
    const route = data.routes.find(r=>r.id===routeIdOrNull);
    title = `Žebříček – ${route?.name ?? 'Trať'}`;
    rides = rides.filter(r=>r.routeId===routeIdOrNull);
    hint = `Počet jízd: ${rides.length}. ${hint}`;
  } else {
    hint = `${state.source ? (state.source + ': ') : ''}Všechny tratě. ${hint}`;
  }

  rides.sort((a,b)=>a.totalMs - b.totalMs);

  $('#leaderTitle').textContent = title;
  $('#leaderHint').textContent = hint;

  if (!rides.length){
    list.innerHTML = `<div class="hint">Zatím žádné uložené jízdy.</div>`;
    openModal('modalLeaderboard');
    return;
  }

  rides.slice(0, 60).forEach((r, i)=>{
    const route = data.routes.find(x=>x.id===r.routeId);
    const el = document.createElement('div');
    el.className = 'leader-item';
    const date = new Date(r.dateIso);
    const dateText = date.toLocaleDateString('cs-CZ', {day:'2-digit', month:'2-digit', year:'numeric'});
    const timeText = formatTimeShort(r.totalMs);
    const who = r.runnerName ? escapeHtml(r.runnerName) : dateText;
    el.innerHTML = `
      <div class="rank">#${i+1}</div>
      <div class="main">
        <div class="d">${escapeHtml(route?.name ?? 'Trať')} • ${who}</div>
        <div class="s">${r.note ? escapeHtml(r.note) : '—'}</div>
      </div>
      <div class="time">${timeText}</div>
    `;
    list.appendChild(el);
  });

  openModal('modalLeaderboard');
}

// ---------- Export / Import / Reset ----------
$('#btnExport').addEventListener('click', ()=>{
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `splittimer-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
});

$('#fileImportJson').addEventListener('change', async (e)=>{
  const file = e.target.files?.[0];
  if (!file) return;
  try{
    const obj = JSON.parse(await file.text());
    if (!obj || !Array.isArray(obj.routes) || !Array.isArray(obj.rides)) throw new Error('bad format');
    data = obj;
    saveData();
    closeModal('modalMenu');
    showScreen('routes');
    alert('Import hotový ✅');
  }catch{
    alert('Neplatný soubor.');
  } finally {
    $('#fileImportJson').value = '';
  }
});

$('#btnReset').addEventListener('click', ()=>{
  if (!confirm('Opravdu smazat všechna data?')) return;
  localStorage.removeItem(STORAGE_KEY);
  data = loadData();
  closeModal('modalMenu');
  showScreen('routes');
});


// ---------- Duel track helpers ----------
function getCheckpointFractions(route){
  const cps = route.checkpoints || [];
  // If checkpoints include distanceKm, use it; else equally spaced.
  const dists = cps.map(c=>Number.isFinite(c.distanceKm)?c.distanceKm:null);
  const have = dists.some(v=>v!=null);
  if (have){
    const max = Math.max(...dists.filter(v=>v!=null));
    const end = Number.isFinite(route.totalDistanceKm) ? route.totalDistanceKm : max;
    const denom = (end && end>0) ? end : (max || 1);
    return cps.map((c,i)=>{
      const v = Number.isFinite(c.distanceKm) ? c.distanceKm/denom : (i/(Math.max(1,cps.length-1)));
      return Math.min(1, Math.max(0, v));
    });
  }
  const n = Math.max(1, cps.length-1);
  return cps.map((_, i)=> i/n);
}

function renderTrackMarks(route){
  const marks = $('#trackMarks');
  if (!marks) return;
  marks.innerHTML = '';
  const fr = getCheckpointFractions(route);
  fr.forEach((f, i)=>{
    const div = document.createElement('div');
    div.className = 'track-mark';
    div.style.left = `${f*100}%`;
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = (i===0) ? 'START' : (i===fr.length-1 ? 'CÍL' : `CP${i+1}`);
    div.appendChild(lbl);
    marks.appendChild(div);
  });
}

function getBestRideForRoute(route){
  const fin = getFinishLeaderboard(route);
  if (!fin.length) return null;
  const bestId = fin[0].rideId;
  return data.rides.find(r=>r.id===bestId) || null;
}

function getBestCumulativeTimes(route){
  const bestRide = getBestRideForRoute(route);
  const cps = route.checkpoints || [];
  const times = [];
  for (let i=0;i<cps.length;i++){
    let t = null;
    if (bestRide && Array.isArray(bestRide.marks) && bestRide.marks.length>i && Number.isFinite(bestRide.marks[i]?.elapsedMs)){
      t = bestRide.marks[i].elapsedMs;
    } else {
      const lb = getCheckpointLeaderboard(route, i);
      if (lb.length) t = lb[0].t;
    }
    times.push(t);
  }
  const fin = getFinishLeaderboard(route);
  if (times.length && (times[times.length-1]==null) && fin.length) times[times.length-1] = fin[0].t;
  return times;
}

function pxWithinTrack(fraction){
  const track = $('#track');
  if (!track) return 0;
  const pad = 14;
  const w = track.clientWidth - pad*2;
  return pad + w * Math.min(1, Math.max(0, fraction));
}

function setRiderLeft(id, px){
  const el = $('#'+id);
  const track = $('#track');
  if (!el || !track || !track.clientWidth) return;
  const left = (px / track.clientWidth) * 100;
  el.style.left = `${left}%`;
}

function resetDuelForRide(route){
  if (!state.ride) return;
  state.ride.visual = { segIdx: 0, segStartMs: 0, offsetPx: 0 };
  renderTrackMarks(route);
  const p0 = pxWithinTrack(0);
  setRiderLeft('riderBest', p0);
  setRiderLeft('riderYou', p0);
}

function updateOffsetOnCheckpoint(route, checkpointIdx, elapsedAtCp){
  const bestTimes = getBestCumulativeTimes(route);
  const bestAt = bestTimes[checkpointIdx] ?? null;
  if (bestAt == null) return;

  const delta = elapsedAtCp - bestAt; // + behind
  const steps = Math.floor(Math.abs(delta) / 5000); // 5s steps
  const dir = delta > 0 ? -1 : +1; // behind -> back
  const stepPx = 10;
  state.ride.visual.offsetPx = dir * steps * stepPx;

  state.ride.visual.segIdx = checkpointIdx;
  state.ride.visual.segStartMs = elapsedAtCp;
}

function updateDuelPositions(route){
  const ride = state.ride;
  if (!route || !ride) return;
  const fr = getCheckpointFractions(route);
  if (!fr.length) return;

  const bestTimes = getBestCumulativeTimes(route);
  const segIdx = Math.min(ride.visual?.segIdx ?? 0, fr.length-1);
  const segStartF = fr[segIdx] ?? 0;
  const segEndF = fr[Math.min(segIdx+1, fr.length-1)] ?? 1;

  const tStart = segIdx===0 ? 0 : (bestTimes[segIdx-1] ?? 0);
  const tEnd = bestTimes[segIdx] ?? (tStart + 60000);
  const segDur = Math.max(15000, (tEnd - tStart) || 60000);

  const elapsedNow = ride.running ? (nowMs() - ride.startMs) : (ride.stoppedMs ?? 0);
  const segElapsed = Math.max(0, elapsedNow - (ride.visual?.segStartMs ?? 0));
  const p = Math.min(1, segElapsed / segDur);

  const baseF = segStartF + (segEndF - segStartF) * p;
  const basePx = pxWithinTrack(baseF);

  setRiderLeft('riderBest', basePx);
  setRiderLeft('riderYou', basePx + (ride.visual?.offsetPx ?? 0));
}


// ---------- Profile drawing ----------
function drawProfile(route){
  const canvas = $('#profileCanvas');
  const ctx = canvas.getContext('2d');

  // HiDPI
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor((rect.width*0.35) * dpr); // aspect similar to mock
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.width*0.35;

  // background
  ctx.clearRect(0,0,w,h);
  roundRect(ctx, 0, 0, w, h, 12, '#f7f9fc');
  ctx.save();
  ctx.beginPath();
  clipRoundRect(ctx, 0, 0, w, h, 12);
  ctx.clip();

  if (!route.profile || route.profile.length < 2){
    // empty
    ctx.fillStyle = '#667085';
    ctx.font = '600 13px -apple-system, system-ui, Segoe UI, Roboto';
    ctx.fillText('Profil zatím není (importuj GPX)', 14, 22);
    ctx.restore();
    return;
  }

  const pts = route.profile;
  const maxD = pts[pts.length-1].distanceKm;
  let minE = Infinity, maxE = -Infinity;
  for (const p of pts){ minE = Math.min(minE, p.elevationM); maxE = Math.max(maxE, p.elevationM); }
  if (minE === maxE){ maxE += 1; }

  const pad = {l:40, r:12, t:10, b:26};
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;

  // grid
  ctx.strokeStyle = 'rgba(102,112,133,.28)';
  ctx.lineWidth = 1;
  for (let i=0;i<=4;i++){
    const y = pad.t + innerH*(i/4);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w-pad.r, y); ctx.stroke();
  }

  // area path
  const x = (km)=> pad.l + (km/maxD)*innerW;
  const y = (m)=> pad.t + (1 - (m-minE)/(maxE-minE))*innerH;

  ctx.beginPath();
  ctx.moveTo(x(pts[0].distanceKm), y(pts[0].elevationM));
  for (const p of pts){
    ctx.lineTo(x(p.distanceKm), y(p.elevationM));
  }
  // close to bottom
  ctx.lineTo(x(pts[pts.length-1].distanceKm), pad.t+innerH);
  ctx.lineTo(x(pts[0].distanceKm), pad.t+innerH);
  ctx.closePath();

  // fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t+innerH);
  grad.addColorStop(0, '#2f7d3f');
  grad.addColorStop(1, '#6dbf72');
  ctx.fillStyle = grad;
  ctx.fill();

  // ridge line
  ctx.beginPath();
  ctx.moveTo(x(pts[0].distanceKm), y(pts[0].elevationM));
  for (const p of pts){ ctx.lineTo(x(p.distanceKm), y(p.elevationM)); }
  ctx.strokeStyle = 'rgba(14,54,24,.55)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // axes labels (simple)
  ctx.fillStyle = '#223';
  ctx.font = '700 12px -apple-system, system-ui, Segoe UI, Roboto';
  ctx.fillText(`${Math.round(maxE)} m`, 8, pad.t+12);
  ctx.fillText(`${Math.round(minE)} m`, 8, pad.t+innerH);

  // x ticks at 0, 1/3, 2/3, end
  const ticks = [0, maxD/3, (2*maxD)/3, maxD];
  ctx.fillStyle = '#223';
  ticks.forEach((t, i)=>{
    const tx = x(t);
    ctx.strokeStyle = 'rgba(102,112,133,.35)';
    ctx.beginPath(); ctx.moveTo(tx, pad.t); ctx.lineTo(tx, pad.t+innerH); ctx.stroke();
    const label = `${Math.round(t)} km`;
    const lw = ctx.measureText(label).width;
    ctx.fillText(label, tx - lw/2, h-8);
  });

  // checkpoint markers if have distance
  const cps = route.checkpoints.filter(c=>Number.isFinite(c.distanceKm));
  cps.forEach((cp, idx)=>{
    const cx = x(cp.distanceKm);
    // find nearest profile elevation
    const elev = nearestElevation(cp.distanceKm, pts);
    const cy = y(elev);
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI*2);
    ctx.fillStyle = (idx===0?'#2aa36c':(idx===route.checkpoints.length-1?'#d64545':'#2a6fb8'));
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  ctx.restore();
}

function nearestElevation(km, pts){
  let best = pts[0].elevationM, bestD = Infinity;
  for (const p of pts){
    const d = Math.abs(p.distanceKm - km);
    if (d < bestD){ bestD = d; best = p.elevationM; }
  }
  return best;
}

function roundRect(ctx, x,y,w,h,r, fill){
  ctx.beginPath();
  clipRoundRect(ctx,x,y,w,h,r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}
function clipRoundRect(ctx, x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
}

window.addEventListener('resize', ()=>{
  if (state.screen==='route'){
    const route = getCurrentRoute();
    if (route) drawProfile(route);
  }
});

// ---------- GPX parsing (basic) ----------
function parseGpx(xmlText){
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const trkpts = Array.from(doc.getElementsByTagName('trkpt'));
  if (!trkpts.length) throw new Error('no trkpt');

  const pts = [];
  for (const p of trkpts){
    const lat = parseFloat(p.getAttribute('lat'));
    const lon = parseFloat(p.getAttribute('lon'));
    const eleNode = p.getElementsByTagName('ele')[0];
    const ele = eleNode ? parseFloat(eleNode.textContent) : 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pts.push({lat, lon, ele: Number.isFinite(ele) ? ele : 0});
  }
  if (pts.length < 2) throw new Error('too few points');

  // distance + ascent
  let distKm = 0;
  let ascent = 0;
  const profile = [{distanceKm:0, elevationM: pts[0].ele}];

  for (let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i];
    const d = haversineKm(a.lat, a.lon, b.lat, b.lon);
    distKm += d;
    const de = b.ele - a.ele;
    if (de > 0) ascent += de;
    profile.push({distanceKm: distKm, elevationM: b.ele});
  }
  return { totalDistanceKm: distKm, totalAscentM: ascent, profile };
}

function downsampleProfile(profile, maxPoints){
  if (profile.length <= maxPoints) return profile;
  // uniform sampling
  const step = (profile.length-1) / (maxPoints-1);
  const out = [];
  for (let i=0;i<maxPoints;i++){
    const idx = Math.round(i*step);
    out.push(profile[idx]);
  }
  // ensure last point exactly last
  out[out.length-1] = profile[profile.length-1];
  return out;
}

function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const toRad = (x)=>x*Math.PI/180;
  const dLat = toRad(lat2-lat1);
  const dLon = toRad(lon2-lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R*c;
}
function round2(x){ return Math.round(x*100)/100; }

function showToast(html, ms=2200){
  const t = $('#toast');
  if (!t) return;
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(()=>{ t.hidden = true; }, ms);
}

// ---------- Safety: escape HTML ----------

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c)=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Initial render
state.source = loadSource();
updateSourceUi();
if (!state.source){
  showScreen('source');
} else {
  showScreen('routes');
}

