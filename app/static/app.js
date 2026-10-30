/* תמלול בעברית – עורך */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PALETTE = ['#2a7de1', '#e0742a', '#2aa05a', '#a94bd6', '#d1a20f', '#d2457e', '#1aa3a3', '#7a6a58'];
const CUT_COLOR = 'rgba(214, 69, 69, 0.30)';
const DELETED_COLOR = 'rgba(120, 120, 120, 0.22)';
const KIND_LABEL = { silence: 'שקט', filler: 'מילוי', manual: 'חיתוך' };

// ------------------------------------------------------------------ desktop / engine
// בחלון טאורי הממשק מוגש מ-tauri.localhost והמנוע (server.py) רץ בנפרד על 127.0.0.1,
// בפורט ועם טוקן שהמעטפת בוחרת בכל הפעלה (הפקודה engine_info).
// בדפדפן רגיל השרת מגיש גם את הממשק, אז הכתובות יחסיות ואין טוקן.
const TAURI = window.__TAURI__ || null;
let API = '';
let TOKEN = '';
let ENGINE_ERROR = null;
let ENGINE = null; // last engine_info: {port, token, error, generation, attached}
let EXITED_GEN = 0; // generation of the last engine that exited on its own
let WAITING_FOR_ENGINE = false;
const ENGINE_GONE = () => !!ENGINE && EXITED_GEN === ENGINE.generation;

function applyEngineInfo(info) {
  ENGINE = info;
  API = `http://127.0.0.1:${info.port}`;
  TOKEN = info.token || '';
  ENGINE_ERROR = info.error || null;
}

async function connectEngine() {
  if (!TAURI) return;
  applyEngineInfo(await TAURI.core.invoke('engine_info'));
  // The shell reports when the engine process stops on its own (crash, killed, out of memory).
  TAURI.event.listen('engine-exited', (e) => {
    if (!ENGINE || e.payload.generation !== ENGINE.generation) return; // an engine we already replaced
    EXITED_GEN = e.payload.generation;
    if (WAITING_FOR_ENGINE) return; // waitForEngine notices and reports it itself
    stopWatchingJob();
    $('#jobOverlay').classList.add('hidden');
    const code = e.payload.code == null ? '' : ` (קוד ${e.payload.code})`;
    showEngineProblem('מנוע התמלול נסגר', `המנוע הפסיק לפעול${code}. עבודה שרצה באותו רגע נקטעה. אפשר להפעיל אותו מחדש בלי לסגור את התוכנה.`);
  });
}

// ------------------------------------------------------------------ engine problems, restart, log
async function engineLogText(lines = 150) {
  try { return await TAURI.core.invoke('engine_log', { lines }); } catch (e) { return 'לא ניתן לקרוא את היומן: ' + e; }
}

function showEngineProblem(title, msg) {
  const canRestart = TAURI && ENGINE && !ENGINE.attached;
  openModal(`<h2>${esc(title)}</h2>
    <p>${esc(msg)}</p>
    <div class="row">
      ${canRestart ? '<button class="btn primary" id="engRestart">הפעל את המנוע מחדש</button>' : ''}
      ${TAURI ? '<button class="btn ghost" id="engLogBtn">הצג יומן</button>' : ''}
    </div>
    <pre class="engine-log hidden" id="engLog" dir="ltr"></pre>`);
  $('#engRestart')?.addEventListener('click', restartEngine);
  $('#engLogBtn')?.addEventListener('click', async () => {
    const pre = $('#engLog');
    pre.textContent = await engineLogText();
    pre.classList.remove('hidden');
    pre.scrollTop = pre.scrollHeight;
  });
}

async function restartEngine() {
  const btn = $('#engRestart') || $('#stEngRestart');
  if (btn) { btn.disabled = true; btn.textContent = 'מפעיל מחדש…'; }
  try {
    applyEngineInfo(await TAURI.core.invoke('restart_engine'));
  } catch (e) {
    showEngineProblem('ההפעלה מחדש נכשלה', String(e));
    return;
  }
  closeModal();
  try { await waitForEngine(); } catch (_) { return; }
  // Media URLs carry the old port, so an open project has to be reopened; save local edits first.
  if (P && !$('#editor').classList.contains('hidden')) {
    await saveNow();
    if (dirty) { toast('המנוע חזר, אבל השינויים האחרונים לא נשמרו. נסה לשמור שוב לפני שתמשיך.', { error: true, timeout: 12000 }); return; }
    openProject(P.id);
  } else {
    showHome();
  }
  toast('מנוע התמלול הופעל מחדש');
}

// Headers for every engine call; media URLs carry the token as ?t= instead.
function authHeaders(extra = {}) {
  return TOKEN ? { ...extra, 'X-Tamlul-Token': TOKEN } : extra;
}
function mediaUrl(path) {
  return API + path + (TOKEN ? `?t=${encodeURIComponent(TOKEN)}` : '');
}

const MEDIA_EXT = ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'wma'];
const AUDIO_EXT = ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'wma', 'mp4'];

async function pickFiles({ multiple = false, kind = 'media' } = {}) {
  if (!TAURI) return (await api('/api/pick', { method: 'POST', body: { multiple, kind } })).files;
  const res = await TAURI.dialog.open({
    multiple,
    filters: [
      kind === 'audio' ? { name: 'קבצי אודיו', extensions: AUDIO_EXT } : { name: 'קבצי וידאו ואודיו', extensions: MEDIA_EXT },
      { name: 'כל הקבצים', extensions: ['*'] },
    ],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

function openExternal(url) {
  if (TAURI) TAURI.opener.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

// The engine loads torch and the models' code at startup; wait for it before the first call.
async function waitForEngine(timeoutMs = 90000) {
  WAITING_FOR_ENGINE = true;
  try { await waitForEngineInner(timeoutMs); } finally { WAITING_FOR_ENGINE = false; }
}
async function waitForEngineInner(timeoutMs) {
  const t0 = Date.now();
  let shown = false;
  const fail = (title, msg) => {
    $('#jobOverlay').classList.add('hidden');
    $('#jobBar').parentElement.classList.remove('hidden');
    $('#jobCancel').classList.remove('hidden');
    showEngineProblem(title, msg);
    throw new Error(title);
  };
  if (ENGINE_ERROR) fail('המנוע לא עלה', ENGINE_ERROR);
  for (;;) {
    try {
      const r = await fetch(API + '/api/health', { cache: 'no-store', headers: authHeaders() });
      const h = r.ok ? await r.json() : null;
      if (h && h.app === 'tamlul') {
        if (!h.authed) fail('המנוע לא מזוהה', 'תוכנה אחרת עונה בפורט של המנוע. סגור את התוכנה ופתח אותה מחדש.');
        break;
      }
    } catch (e) {
      if (e.message === 'המנוע לא מזוהה') throw e;
      /* not up yet */
    }
    if (ENGINE_GONE()) fail('מנוע התמלול נסגר', 'המנוע נסגר בזמן שעלה. היומן מראה מה קרה.');
    if (!shown && Date.now() - t0 > 400) {
      $('#jobTitle').textContent = 'טוען את מנוע התמלול…';
      $('#jobMsg').textContent = 'בפעם הראשונה אחרי הדלקת המחשב זה יכול לקחת עד דקה.';
      $('#jobBar').parentElement.classList.add('hidden');
      $('#jobCancel').classList.add('hidden');
      $('#jobOverlay').classList.remove('hidden');
      shown = true;
    }
    if (Date.now() - t0 > timeoutMs) {
      fail('המנוע לא עלה', TAURI
        ? 'מנוע התמלול לא ענה תוך דקה וחצי. היומן מראה מה קרה. אם חסרה התקנה, צריך להריץ את install.bat.'
        : 'הפרטים בקובץ data\\engine.log בתיקיית התוכנה. אם חסרה התקנה – להריץ install.bat.');
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  if (shown) {
    $('#jobOverlay').classList.add('hidden');
    $('#jobBar').parentElement.classList.remove('hidden');
    $('#jobCancel').classList.remove('hidden');
  }
}

// ------------------------------------------------------------------ helpers
async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.body && typeof o.body !== 'string') {
    o.body = JSON.stringify(o.body);
    o.headers = { ...o.headers, 'Content-Type': 'application/json' };
  }
  o.headers = authHeaders(o.headers);
  const r = await fetch(API + path, o);
  let data = null;
  try { data = await r.json(); } catch (_) { /* empty */ }
  if (!r.ok) throw new Error((data && (data.error || data.detail)) || `שגיאה ${r.status}`);
  return data;
}

function fmt(t, withTenths = true) {
  t = Math.max(0, t || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const ss = withTenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')) + ':' + ss;
}
function parseTime(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some(isNaN)) return null;
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}
function uid() { return Math.random().toString(16).slice(2, 12); }
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function toast(msg, { actions = [], error = false, timeout = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = `<span>${esc(msg)}</span>`;
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = 'btn small';
    b.textContent = a.label;
    b.onclick = () => { a.run(); el.remove(); };
    el.appendChild(b);
  }
  $('#toasts').appendChild(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
  return el;
}

function openModal(html) {
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  return $('#modalBody');
}
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modalClose').onclick = closeModal;
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });

function showMenu(x, y, items) {
  const m = $('#menu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button');
    b.innerHTML = it.html || esc(it.label);
    b.onclick = () => { hideMenu(); it.run(); };
    m.appendChild(b);
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
}
function hideMenu() { $('#menu').classList.add('hidden'); }
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#menu')) hideMenu(); });

// ------------------------------------------------------------------ settings
let SETTINGS = null;
async function loadSettings() {
  SETTINGS = await api('/api/settings');
  const b = $('#gpuBadge');
  if (SETTINGS.gpu && SETTINGS.gpu.cuda) { b.textContent = '⚡ ' + SETTINGS.gpu.name; b.className = 'badge'; }
  else { b.textContent = SETTINGS.gpu && SETTINGS.gpu.name ? SETTINGS.gpu.name : 'ללא כרטיס מסך – איטי'; b.className = 'badge warn'; }
}

async function openSettings() {
  await loadSettings();
  await loadAI();
  const s = SETTINGS;
  const speakers = await api('/api/speakers');
  const corr = Object.entries(s.corrections || {});
  const body = openModal(`
    <h2>הגדרות</h2>
    <h3>מילים מיוחדות</h3>
    <p class="hint">שמות, מונחים ומילים לועזיות שהתוכנה צריכה לזהות. מילה בכל שורה.</p>
    <textarea id="stVocab" placeholder="Meida4U&#10;זום&#10;פודקאסט">${esc((s.vocabulary || []).join('\n'))}</textarea>

    <h3>מילון תיקונים</h3>
    <p class="hint">כשהתוכנה טועה באותה מילה שוב ושוב: משמאל מה שהיא כתבה, מימין מה שצריך להיות. התיקונים מוחלים אוטומטית על כל תמלול חדש.</p>
    <table class="corr-table" id="corrTable">
      <tr><th>הטעות</th><th>התיקון</th><th></th></tr>
      ${corr.map(([w, r]) => corrRow(w, r)).join('')}
    </table>
    <button class="btn small" id="addCorr">＋ הוסף תיקון</button>

    <h3>הפסקות ומילות מילוי</h3>
    <div class="row"><label>הפסקה ארוכה מ־ (שניות)</label><input type="number" step="0.1" min="0.3" id="stSilMin" value="${s.silence_min}"></div>
    <div class="row"><label>אורך ההפסקה שנשאר (שניות)</label><input type="number" step="0.05" min="0" id="stSilKeep" value="${s.silence_keep}"></div>
    <p class="hint">מילות מילוי לסימון (מופרדות ברווח):</p>
    <input id="stFillers" style="width:100%" value="${esc((s.fillers || []).join(' '))}">

    <h3>זיהוי דוברים</h3>
    <div class="row"><label>רגישות (נמוך = מאחד יותר דוברים)</label>
      <input type="range" min="0.25" max="0.75" step="0.01" id="stThr" value="${s.speaker_threshold}"><span id="stThrV">${s.speaker_threshold}</span></div>
    <p class="hint">קולות שמורים (מזוהים אוטומטית בשם):</p>
    <div id="voiceList">${speakers.length ? speakers.map((n) => `
      <div class="sp-row"><span class="dot" style="background:#0f6e6a"></span><span>${esc(n)}</span><span></span>
      <button class="btn small danger" data-del-voice="${esc(n)}">מחק</button></div>`).join('') : '<p class="hint">עדיין לא נשמרו קולות. אפשר לשמור קול מתוך מסך "דוברים" בעורך.</p>'}</div>

    <h3>כתוביות</h3>
    <label class="check"><input type="checkbox" id="stSrtSp" ${s.srt_speaker ? 'checked' : ''}> להוסיף את שם הדובר בתחילת כל כתובית</label><br>
    <label class="check"><input type="checkbox" id="stRtl" ${s.srt_rtl_fix ? 'checked' : ''}> תיקון כיוון עברית (אם בנגן הנקודות והמספרים קופצים לצד הלא נכון)</label>

    <h3>✨ עוזר AI (Claude)</h3>
    <div class="row"><label>מפתח API</label>
      <span class="hint" style="direction:ltr">${AI && AI.has_key ? esc(AI.masked) : 'לא הוגדר'}</span>
      ${AI && AI.from_env ? '<span class="badge">מקובץ ‎.env</span>' : ''}
      ${AI && AI.has_key && !AI.from_env ? '<button class="btn small ghost danger" id="stKeyDel">הסר מפתח</button>' : ''}</div>
    <p class="hint">אפשר גם להדביק את המפתח בקובץ <b>‎.env</b> שבתיקיית התוכנה (בשורה ANTHROPIC_API_KEY=). מפתח בקובץ קודם למפתח שהוזן כאן.</p>
    <div class="row"><label>${AI && AI.has_key ? 'החלפת מפתח' : 'הדבק מפתח'}</label>
      <input id="stKey" type="password" placeholder="sk-ant-..." autocomplete="off" style="flex:1">
      <button class="btn small" id="stKeyTest">שמור ובדוק</button></div>
    <div class="row"><label>מודל</label>
      <select id="stModel">${(AI ? AI.models : []).map((m) => `<option value="${m.id}" ${AI.model === m.id ? 'selected' : ''}>${esc(m.label)} ($${m.in} / $${m.out} למיליון טוקנים)</option>`).join('')}</select></div>
    <div class="row"><label>הוצאה משוערת עד היום</label><b>$${AI ? (AI.spent || 0).toFixed(2) : '0.00'}</b>
      <button class="btn small ghost" id="stSpentReset">אפס מונה</button></div>
    <div class="row">
      <button class="btn small" data-url="keys">חשבון מפתחים ומפתחות ↗</button>
      <button class="btn small primary" data-url="billing">קניית קרדיטים ↗</button></div>
    <p class="hint">הקרדיט נקנה באתר של Claude (כרטיס אשראי, אפשר גם טעינה אוטומטית). ההוצאה המוצגת כאן היא הערכה של התוכנה; הסכום המדויק מופיע בעמוד החיוב באתר.</p>

    ${TAURI ? `<h3>מנוע התמלול</h3>
    <div class="row"><label>מצב</label><span class="hint" id="stEngState">בודק…</span></div>
    <div class="row">
      <button class="btn small" id="stEngLog">הצג יומן</button>
      ${ENGINE && !ENGINE.attached ? '<button class="btn small ghost" id="stEngRestart">הפעל את המנוע מחדש</button>' : ''}</div>
    <pre class="engine-log hidden" id="stEngLogText" dir="ltr"></pre>` : ''}

    <div class="row" style="margin-top:1.4rem"><button class="btn primary" id="stSave">שמור הגדרות</button></div>
  `);
  if (TAURI) {
    api('/api/health').then((h) => {
      const dev = h.device === 'cuda' ? 'כרטיס מסך' : h.device === 'cpu' ? 'מעבד' : 'המודל ייטען בתמלול הבא';
      $('#stEngState') && ($('#stEngState').textContent = `פועל · גרסה ${h.version} · ${dev} · פורט ${ENGINE.port}`);
    }).catch(() => { $('#stEngState') && ($('#stEngState').textContent = 'לא עונה'); });
    $('#stEngLog').onclick = async () => {
      const pre = $('#stEngLogText');
      pre.textContent = await engineLogText();
      pre.classList.remove('hidden');
      pre.scrollTop = pre.scrollHeight;
    };
    $('#stEngRestart')?.addEventListener('click', restartEngine);
  }
  $('#stKeyTest').onclick = async () => { if (await saveKeyAndTest($('#stKey').value)) { closeModal(); openSettings(); } };
  $('#stKeyDel')?.addEventListener('click', async () => {
    if (!confirm('להסיר את מפתח ה-API מהמחשב?')) return;
    AI = await api('/api/ai', { method: 'POST', body: { clear_key: true } });
    closeModal(); openSettings();
  });
  $('#stModel').onchange = async (e) => { AI = await api('/api/ai', { method: 'POST', body: { model: e.target.value } }); toast('המודל עודכן'); };
  $('#stSpentReset').onclick = async () => { AI = await api('/api/ai', { method: 'POST', body: { reset_spent: true } }); closeModal(); openSettings(); };
  $('#stThr').oninput = (e) => { $('#stThrV').textContent = e.target.value; };
  $('#addCorr').onclick = () => $('#corrTable').insertAdjacentHTML('beforeend', corrRow('', ''));
  $('#corrTable').onclick = (e) => { if (e.target.dataset.delCorr !== undefined) e.target.closest('tr').remove(); };
  body.querySelectorAll('[data-del-voice]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`למחוק את הקול השמור של "${b.dataset.delVoice}"?`)) return;
      await api('/api/speakers/' + encodeURIComponent(b.dataset.delVoice), { method: 'DELETE' });
      b.closest('.sp-row').remove();
    };
  });
  $('#stSave').onclick = async () => {
    const corrections = {};
    $$('#corrTable tr').forEach((tr) => {
      const [w, r] = $$('input', tr).map((i) => i.value.trim());
      if (w && r) corrections[w] = r;
    });
    SETTINGS = await api('/api/settings', {
      method: 'POST', body: {
        vocabulary: $('#stVocab').value.split('\n'),
        corrections,
        fillers: $('#stFillers').value.split(/\s+/).filter(Boolean),
        silence_min: parseFloat($('#stSilMin').value) || 1,
        silence_keep: parseFloat($('#stSilKeep').value) || 0,
        speaker_threshold: parseFloat($('#stThr').value),
        srt_speaker: $('#stSrtSp').checked,
        srt_rtl_fix: $('#stRtl').checked,
      },
    });
    closeModal();
    toast('ההגדרות נשמרו');
    if (P) renderAITab();
  };
}
function corrRow(w, r) {
  return `<tr><td><input value="${esc(w)}" placeholder="מה שנכתב"></td><td><input value="${esc(r)}" placeholder="מה שצריך להיות"></td>
  <td><button class="btn small ghost" data-del-corr>✕</button></td></tr>`;
}
$('#openSettings').onclick = openSettings;

// ------------------------------------------------------------------ home
const NP = { video: '', tracks: [] };

function guessSpeaker(path) {
  let n = path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  n = n.replace(/^audio/i, '').replace(/\d+$/, '').replace(/[_-]+/g, ' ').trim();
  return n || 'דובר';
}

function renderNewProject() {
  $('#npVideo').textContent = NP.video || 'לא נבחר קובץ';
  $('#clearVideo').classList.toggle('hidden', !NP.video);
  $('#npTracks').innerHTML = NP.tracks.map((t, i) => `
    <div class="track-row">
      <div class="path" title="${esc(t.path)}">${esc(t.path.split(/[\\/]/).pop())}</div>
      <input data-sp="${i}" value="${esc(t.speaker)}" placeholder="שם הדובר">
      <button class="btn icon ghost" data-rm="${i}" title="הסר">✕</button>
    </div>`).join('');
  $$('#npTracks [data-sp]').forEach((inp) => { inp.oninput = () => { NP.tracks[+inp.dataset.sp].speaker = inp.value; }; });
  $$('#npTracks [data-rm]').forEach((b) => { b.onclick = () => { NP.tracks.splice(+b.dataset.rm, 1); renderNewProject(); }; });
}

$('#pickVideo').onclick = async () => {
  const files = await pickFiles({ multiple: false });
  if (files.length) {
    NP.video = files[0];
    if (!$('#npName').value) $('#npName').value = files[0].split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    renderNewProject();
  }
};
$('#clearVideo').onclick = () => { NP.video = ''; renderNewProject(); };
$('#addTracks').onclick = async () => {
  const files = await pickFiles({ multiple: true, kind: 'audio' });
  for (const f of files) NP.tracks.push({ path: f, speaker: guessSpeaker(f) });
  renderNewProject();
};
$('#startProject').onclick = async () => {
  if (!NP.video && !NP.tracks.length) { toast('צריך לבחור קובץ וידאו או הקלטה', { error: true }); return; }
  try {
    const { id } = await api('/api/projects', {
      method: 'POST', body: { name: $('#npName').value, video: NP.video, tracks: NP.tracks },
    });
    NP.video = ''; NP.tracks = []; $('#npName').value = '';
    renderNewProject();
    openProject(id);
  } catch (e) { toast(e.message, { error: true, timeout: 9000 }); }
};

async function renderProjects() {
  const list = await api('/api/projects');
  const el = $('#projectList');
  if (!list.length) { el.innerHTML = '<div class="empty">עדיין אין פרויקטים. בחר קובץ ולחץ "התחל תמלול".</div>'; return; }
  el.innerHTML = list.map((p) => {
    const st = p.job === 'running' ? '⏳ בעבודה…' : p.status === 'ready' ? `${p.segments} משפטים`
      : p.status === 'error' ? '⚠ התמלול נכשל' : p.status === 'interrupted' ? '⚠ התמלול נקטע'
      : p.status === 'cancelled' ? 'התמלול בוטל' : p.status === 'transcribing' ? '⚠ התמלול לא הסתיים' : '';
    return `<div class="proj" data-id="${p.id}">
      <div class="grow"><div class="name">${esc(p.name)}</div>
      <div class="meta">${fmt(p.duration, false)} · ${st} · ${new Date(p.updated * 1000).toLocaleDateString('he-IL')}</div></div>
      <button class="btn small ghost danger" data-del="${p.id}" title="מחק פרויקט">🗑</button></div>`;
  }).join('');
  $$('.proj', el).forEach((row) => {
    row.onclick = (e) => {
      if (e.target.dataset.del) return;
      openProject(row.dataset.id);
    };
  });
  $$('[data-del]', el).forEach((b) => {
    b.onclick = async () => {
      if (!confirm('למחוק את הפרויקט? (קבצי הווידאו המקוריים לא יימחקו)')) return;
      await api('/api/projects/' + b.dataset.del, { method: 'DELETE' });
      renderProjects();
    };
  });
}

function showHome() {
  teardownEditor();
  $('#editor').classList.add('hidden');
  $('#home').classList.remove('hidden');
  history.replaceState(null, '', '/');
  renderProjects();
}
$('#backHome').onclick = async () => { await saveNow(); showHome(); };

// ------------------------------------------------------------------ jobs
let jobTimer = null;
function watchJob(pid, { title, onDone, hideable = false }) {
  const ov = $('#jobOverlay');
  $('#jobTitle').textContent = title;
  $('#jobBar').style.width = '0%';
  $('#jobMsg').textContent = '';
  ov.classList.remove('hidden');
  $('#jobCancel').textContent = hideable ? 'המשך לעבוד בינתיים' : 'בטל';
  let hidden = false;
  $('#jobCancel').onclick = async () => {
    if (hideable) { hidden = true; ov.classList.add('hidden'); return; }
    if (confirm('לבטל את הפעולה?')) await api(`/api/projects/${pid}/cancel`, { method: 'POST' });
  };
  // One request at a time: the next poll is scheduled only after the previous one returns, so a slow
  // or stalled engine cannot pile up requests (that once ended in ERR_INSUFFICIENT_RESOURCES).
  const mine = jobTimer = {};
  return new Promise((resolve) => {
    const poll = async () => {
      if (jobTimer !== mine) return; // a newer watchJob took over
      let j = null;
      try { j = await api(`/api/projects/${pid}/job`); } catch (_) { /* engine busy or down */ }
      if (jobTimer !== mine) return;
      if (!j) { setTimeout(poll, 2000); return; }
      $('#jobBar').style.width = Math.round((j.progress || 0) * 100) + '%';
      $('#jobMsg').textContent = (j.message || '') + (j.progress ? `  (${Math.round(j.progress * 100)}%)` : '');
      if (j.state === 'running') { setTimeout(poll, 900); return; }
      jobTimer = null;
      ov.classList.add('hidden');
      if (j.state === 'error') toast(j.error || 'שגיאה', { error: true, timeout: 15000 });
      else if (j.state === 'cancelled') toast('הפעולה בוטלה');
      else if (j.state === 'idle') toast('הפעולה נקטעה (מנוע התמלול נסגר באמצע)', { error: true });
      if (onDone) onDone(j, hidden);
      resolve(j);
    };
    setTimeout(poll, 900);
  });
}
function stopWatchingJob() { jobTimer = null; }

// ------------------------------------------------------------------ editor state
let P = null;            // current project
let wsMain = null, regMain = null;
let lanes = [];          // [{ws, reg, track}]
let removed = [];        // merged removed intervals
let stopAt = null;
let cutMode = false, unsubDrag = null, addingRegions = false;
let selectedId = null, activeId = null;
let undoStack = [];
let redoStack = [];
let cutGroup = new Set();   // ids of the sentences marked by the split-at-playhead cut (all tracks)
let cutStart = null;        // playhead time of the first cut, waiting for the second one
let cutRange = null;        // {start, end} of the marked part, waiting for Delete
let dirty = false, saveTimer = null;
let rafId = null;
let syncingScroll = false;

const video = $('#video');

function segById(id) { return P.segments.find((s) => s.id === id); }
function cutById(id) { return P.cuts.find((c) => c.id === id); }

function speakerColor(name) {
  P.speaker_colors = P.speaker_colors || {};
  if (!P.speaker_colors[name]) {
    const used = new Set(Object.values(P.speaker_colors));
    P.speaker_colors[name] = PALETTE.find((c) => !used.has(c)) || PALETTE[Object.keys(P.speaker_colors).length % PALETTE.length];
  }
  return P.speaker_colors[name];
}
function speakersInProject() {
  const order = [];
  for (const s of P.segments) if (!order.includes(s.speaker)) order.push(s.speaker);
  return order;
}

function currentState() { return JSON.stringify({ segments: P.segments, cuts: P.cuts }); }
function snapshot() {
  undoStack.push(currentState());
  if (undoStack.length > 60) undoStack.shift();
  redoStack = [];
  updateUndoButtons();
}
function restoreState(s) {
  cutGroup.clear(); cutStart = null; cutRange = null; updateSplitBtn();
  const o = JSON.parse(s);
  P.segments = o.segments; P.cuts = o.cuts;
  renderAll();
  markDirty();
  updateUndoButtons();
}
function undo() {
  const s = undoStack.pop();
  if (!s) { toast('אין מה לבטל'); return; }
  redoStack.push(currentState());
  restoreState(s);
}
function redo() {
  const s = redoStack.pop();
  if (!s) { toast('אין מה לבצע שוב'); return; }
  undoStack.push(currentState());
  restoreState(s);
}
function updateUndoButtons() {
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
}

function markDirty() {
  dirty = true;
  $('#saveState').textContent = 'שומר…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 900);
  computeRemoved();
  renderStats();
}
async function saveNow() {
  clearTimeout(saveTimer);
  if (!P || !dirty) return;
  dirty = false;
  try {
    await api('/api/projects/' + P.id, {
      method: 'PUT', body: { name: P.name, segments: P.segments, cuts: P.cuts, speaker_colors: P.speaker_colors },
    });
    $('#saveState').textContent = 'נשמר ✓';
  } catch (e) {
    dirty = true;
    $('#saveState').textContent = 'שגיאה בשמירה';
    toast('השמירה נכשלה: ' + e.message, { error: true });
  }
}
window.addEventListener('beforeunload', (e) => { if (dirty) { saveNow(); e.preventDefault(); } });

function computeRemoved() {
  const iv = P.cuts.filter((c) => c.active !== false).map((c) => [c.start, c.end]);
  for (const s of P.segments) if (s.deleted) iv.push([s.start, s.end]);
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) {
    if (out.length && a <= out[out.length - 1][1] + 0.001) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b);
    else out.push([a, b]);
  }
  removed = out;
}

function renderStats() {
  $('#aiEditedWrap').classList.toggle('hidden', !removed.length);
  const total = removed.reduce((a, [s, e]) => a + (e - s), 0);
  const dur = P.duration || 0;
  $('#cutStats').innerHTML = removed.length
    ? `${P.cuts.length} חיתוכים · נחתך <b>${fmt(total, false)}</b> · אורך חדש ${fmt(dur - total, false)}`
    : `אורך ${fmt(dur, false)} · ${P.segments.length} משפטים`;
}

// ------------------------------------------------------------------ open project
async function openProject(pid) {
  teardownEditor();
  $('#home').classList.add('hidden');
  $('#editor').classList.remove('hidden');
  history.replaceState(null, '', '/#' + pid);
  P = await api('/api/projects/' + pid);
  $('#projName').value = P.name;

  const job = await api(`/api/projects/${pid}/job`);
  if (job.state === 'running') {
    const title = job.kind === 'export' ? 'מייצא וידאו…' : job.kind === 'enroll' ? 'לומד קול…' : 'מתמלל…';
    await watchJob(pid, { title });
    return openProject(pid);
  }
  if (P.status !== 'ready') {
    const why = job.state === 'error' ? 'אירעה שגיאה: ' + esc(job.error)
      : P.status === 'error' ? 'אירעה שגיאה: ' + esc(P.error || '')
      : P.status === 'cancelled' ? 'התמלול בוטל.'
      : 'התמלול נקטע לפני שהסתיים, כנראה כי מנוע התמלול נסגר באמצע.';
    openModal(`<h2>התמלול לא הושלם</h2>
      <p>${why}</p>
      <div class="row"><button class="btn primary" id="retryBtn">תמלל שוב</button>
      <button class="btn ghost" id="homeBtn">חזרה</button></div>`);
    $('#retryBtn').onclick = async () => {
      closeModal();
      await api(`/api/projects/${pid}/retranscribe`, { method: 'POST' });
      openProject(pid);
    };
    $('#homeBtn').onclick = () => { closeModal(); showHome(); };
    return;
  }
  undoStack = [];
  redoStack = [];
  updateUndoButtons();
  dirty = false;
  $('#saveState').textContent = '';
  P.segments.forEach((s) => speakerColor(s.speaker));
  computeRemoved();
  await buildEditor();
}

function teardownEditor() {
  cancelAnimationFrame(rafId);
  if (unsubDrag) { unsubDrag(); unsubDrag = null; }
  if (wsMain) { try { wsMain.destroy(); } catch (_) { /* */ } }
  lanes.forEach((l) => { try { l.ws.destroy(); } catch (_) { /* */ } });
  wsMain = null; regMain = null; lanes = [];
  video.pause();
  video.removeAttribute('src');
  video.load();
  $('#trackLanes').innerHTML = '';
  $('#segList').innerHTML = '';
  if (aiCtrl) aiCtrl.abort();
  $('#aiChat').innerHTML = '';
  delete $('#aiChat').dataset.pid;
  SEARCH = { re: null, matches: [], cur: -1 };
  $('#search').value = '';
  $('#searchCount').textContent = '';
  cutMode = false;
  $('#cutMode').classList.remove('on');
}

async function buildEditor() {
  const base = `/api/projects/${P.id}`;
  video.src = mediaUrl(`${base}/media/main`);
  $('#audioOnly').classList.toggle('hidden', !!P.main.has_video);
  video.onerror = () => toast('הדפדפן לא מצליח לנגן את הקובץ הזה. נסה להמיר אותו ל-MP4.', { error: true, timeout: 12000 });

  const zoom = +$('#zoom').value;
  // square-root scaling makes quiet speech visible next to loud peaks
  const shape = (arr) => arr.map((v) => Math.sqrt(v));
  const mainPeaks = await api(`${base}/peaks/main`);
  mainPeaks.peaks = shape(mainPeaks.peaks);
  const duration = P.duration || mainPeaks.duration;
  P.duration = duration;

  regMain = WaveSurfer.Regions.create();
  wsMain = WaveSurfer.create({
    container: '#wave-main', media: video, height: 76, audioRate: currentSpeed(),
    peaks: [mainPeaks.peaks], duration,
    waveColor: '#9aa6b2', progressColor: '#0f6e6a', cursorColor: '#0f6e6a', cursorWidth: 2,
    minPxPerSec: zoom, autoScroll: true, autoCenter: false, dragToSeek: true,
    plugins: [regMain, WaveSurfer.Timeline.create({ height: 16, style: { fontSize: '11px', color: '#66707c' } })],
  });

  // lanes for speech segments: one per separate track, or one lane for the main audio
  const laneDefs = P.tracks && P.tracks.length
    ? P.tracks.map((t, i) => ({ track: i, label: t.speaker, peaksUrl: `${base}/peaks/t${i}` }))
    : [{ track: null, label: 'משפטים ודוברים', peaksUrl: null }];

  for (const def of laneDefs) {
    const wrap = document.createElement('div');
    wrap.className = 'lane';
    wrap.innerHTML = `<div class="lane-label" dir="rtl">${esc(def.label)}</div><div class="wave"></div>`;
    $('#trackLanes').appendChild(wrap);
    const peaks = def.peaksUrl ? shape((await api(def.peaksUrl)).peaks) : mainPeaks.peaks;
    const reg = WaveSurfer.Regions.create();
    const ws = WaveSurfer.create({
      container: $('.wave', wrap), backend: 'WebAudio', height: def.track === null ? 70 : 58,
      peaks: [peaks], duration,
      waveColor: '#8f9ba7', progressColor: '#8f9ba7', cursorWidth: 0,
      minPxPerSec: zoom, autoScroll: false, hideScrollbar: true, plugins: [reg],
    });
    const lane = { ws, reg, track: def.track };
    lanes.push(lane);
    ws.on('interaction', (t) => { video.currentTime = t; });
    ws.on('scroll', (_s, _e, left) => syncScroll(left, ws));
    reg.on('region-updated', (r) => onSegRegionUpdated(r));
    reg.on('region-clicked', (r, e) => { e.stopPropagation(); selectSeg(r.id, true); video.currentTime = r.start; });
    reg.on('region-double-clicked', (r) => playSeg(r.id));
  }

  wsMain.on('scroll', (_s, _e, left) => syncScroll(left, wsMain));
  regMain.on('region-updated', (r) => {
    const c = cutById(r.id);
    if (!c) return;
    snapshotOnce();
    c.start = +r.start.toFixed(3); c.end = +r.end.toFixed(3);
    markDirty();
  });
  regMain.on('region-double-clicked', (r) => {
    if (!cutById(r.id)) return;
    snapshot();
    P.cuts = P.cuts.filter((c) => c.id !== r.id);
    r.remove();
    markDirty();
    toast('החיתוך הוסר', { actions: [{ label: 'בטל', run: undo }] });
  });
  regMain.on('region-created', (r) => {
    if (addingRegions || !cutMode) return;
    snapshot();
    const c = { id: uid(), start: +r.start.toFixed(3), end: +r.end.toFixed(3), kind: 'manual', active: true };
    r.remove();
    P.cuts.push(c);
    addCutRegion(c);
    markDirty();
  });

  await Promise.all([wsMain, ...lanes.map((l) => l.ws)].map((w) => new Promise((res) => {
    if (w.getDecodedData()) res(); else w.once('ready', res);
  })));
  renderAll();
  loop();
  P.ai_chat = P.ai_chat || [];
  if (!$('#tabAI').classList.contains('hidden')) renderAITab();
}

function snapshotOnce() {
  // one undo step per drag gesture
  const now = Date.now();
  if (!snapshotOnce.t || now - snapshotOnce.t > 700) snapshot();
  snapshotOnce.t = now;
}

function syncScroll(left, source) {
  if (syncingScroll) return;
  syncingScroll = true;
  for (const w of [wsMain, ...lanes.map((l) => l.ws)]) if (w && w !== source) w.setScroll(left);
  syncingScroll = false;
}

function laneForSeg(seg) {
  if (lanes.length === 1) return lanes[0];
  return lanes.find((l) => l.track === seg.track) || lanes[0];
}

// ------------------------------------------------------------------ regions
function segRegionOptions(seg) {
  const col = speakerColor(seg.speaker);
  return {
    id: seg.id, start: seg.start, end: seg.end,
    color: seg.deleted ? DELETED_COLOR : hexA(col, 0.28),
    content: (seg.deleted ? '✂ ' : '') + seg.text.slice(0, 60),
    drag: true, resize: true, minLength: 0.1,
  };
}
function addSegRegion(seg) {
  addingRegions = true;
  laneForSeg(seg).reg.addRegion(segRegionOptions(seg));
  addingRegions = false;
}
function addCutRegion(c) {
  addingRegions = true;
  regMain.addRegion({
    id: c.id, start: c.start, end: c.end, color: CUT_COLOR, drag: true, resize: true, minLength: 0.05,
    content: KIND_LABEL[c.kind] || '',
  });
  addingRegions = false;
}
function findRegion(id) {
  for (const l of lanes) {
    const r = l.reg.getRegions().find((x) => x.id === id);
    if (r) return r;
  }
  return null;
}
function refreshSegRegion(seg) {
  const r = findRegion(seg.id);
  if (r) {
    const o = segRegionOptions(seg);
    r.setOptions({ start: o.start, end: o.end, color: o.color, content: o.content });
  } else addSegRegion(seg);
}
function renderRegions() {
  addingRegions = true;
  regMain.clearRegions();
  lanes.forEach((l) => l.reg.clearRegions());
  addingRegions = false;
  for (const s of P.segments) addSegRegion(s);
  for (const c of P.cuts) addCutRegion(c);
}
function onSegRegionUpdated(r) {
  const seg = segById(r.id);
  if (!seg) return;
  snapshotOnce();
  seg.start = +r.start.toFixed(3);
  seg.end = +r.end.toFixed(3);
  const row = rowOf(seg.id);
  if (row) { $('.ts', row).value = fmt(seg.start); $('.te', row).value = fmt(seg.end); }
  markDirty();
}

// ------------------------------------------------------------------ segment list
function rowOf(id) { return $(`.seg[data-id="${id}"]`, $('#segList')); }

function rowHtml(seg) {
  const col = speakerColor(seg.speaker);
  return `<div class="seg${seg.deleted ? ' deleted' : ''}" data-id="${seg.id}">
    <div class="bar" style="background:${col}"></div>
    <div>
      <div class="meta">
        <button class="who" style="color:${col}" title="החלף דובר">${esc(seg.speaker)}</button>
        <button class="pin" data-a="setStart" title="קבע את התחלת המשפט לנקודה שבה הניגון עומד עכשיו">⏱ התחלה</button>
        <input class="t ts" value="${fmt(seg.start)}" title="זמן התחלה">–<input class="t te" value="${fmt(seg.end)}" title="זמן סיום">
        <button class="pin" data-a="setEnd" title="קבע את סוף המשפט לנקודה שבה הניגון עומד עכשיו">⏱ סוף</button>
        <span class="acts">
          <button data-a="play" title="נגן את המשפט">▶</button>
          <button data-a="split" title="פצל את המשפט במקום הסמן בטקסט (ואם אין סמן – בנקודת הניגון)">⑂</button>
          <button data-a="merge" title="חבר עם המשפט הבא">⤓</button>
          <button data-a="del" title="${seg.deleted ? 'החזר את המשפט' : 'מחק את המשפט (גם מהווידאו)'}">${seg.deleted ? '↺' : '✂'}</button>
        </span>
      </div>
      <div class="text" dir="rtl" contenteditable="plaintext-only" spellcheck="false">${highlight(seg)}</div>
    </div></div>`;
}
function renderList() {
  $('#segList').innerHTML = P.segments.map(rowHtml).join('');
  applySearch();
}
function renderRow(seg) {
  const old = rowOf(seg.id);
  if (!old) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = rowHtml(seg);
  const neu = tmp.firstElementChild;
  if (seg.id === selectedId || cutGroup.has(seg.id)) neu.classList.add('selected');
  if (seg.id === activeId) neu.classList.add('active');
  old.replaceWith(neu);
}
function renderAll() {
  P.segments.sort((a, b) => a.start - b.start);
  if (SEARCH.re) {
    collectMatches();
    SEARCH.cur = Math.min(SEARCH.cur, SEARCH.matches.length - 1);
    if (SEARCH.cur < 0 && SEARCH.matches.length) SEARCH.cur = 0;
    updateSearchCount();
  }
  renderRegions();
  renderList();
  computeRemoved();
  renderStats();
}

function selectSeg(id, scroll) {
  if (selectedId) rowOf(selectedId)?.classList.remove('selected');
  selectedId = id;
  const row = rowOf(id);
  if (row) {
    row.classList.add('selected');
    if (scroll) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function playSeg(id) {
  const s = segById(id);
  if (!s) return;
  video.currentTime = s.start;
  stopAt = s.end;
  video.play();
}

const list = $('#segList');
list.addEventListener('click', (e) => {
  const row = e.target.closest('.seg');
  if (!row) return;
  const id = row.dataset.id;
  const seg = segById(id);
  clearCutGroup();
  selectSeg(id, false);
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'play') playSeg(id);
  else if (a === 'setStart') setEdge(seg, 'start');
  else if (a === 'setEnd') setEdge(seg, 'end');
  else if (a === 'del') {
    snapshot();
    seg.deleted = !seg.deleted;
    renderRow(seg); refreshSegRegion(seg); markDirty();
  } else if (a === 'split') splitSeg(seg);
  else if (a === 'merge') mergeSeg(seg);
  else if (e.target.classList.contains('who')) speakerMenu(seg, e.clientX, e.clientY);
  else if (!e.target.closest('.text') && !e.target.closest('input')) video.currentTime = seg.start;
});
// keep the caret inside the text when an action button is pressed (needed for split at the caret)
list.addEventListener('mousedown', (e) => {
  if (e.target.closest('.acts button')) e.preventDefault();
});
list.addEventListener('focusin', (e) => {
  if (e.target.classList.contains('text')) e.target.dataset.orig = e.target.textContent;
});
list.addEventListener('focusout', (e) => {
  const el = e.target;
  const row = el.closest('.seg');
  if (!row) return;
  const seg = segById(row.dataset.id);
  if (el.classList.contains('text')) {
    const newText = el.textContent.replace(/\s+/g, ' ').trim();
    const orig = (el.dataset.orig || '').replace(/\s+/g, ' ').trim();
    if (newText === orig) return;
    snapshot();
    seg.text = newText;
    const toks = newText.split(' ');
    if (seg.words && seg.words.length === toks.length) seg.words.forEach((w, i) => { w.w = toks[i]; });
    refreshSegRegion(seg);
    if (SEARCH.re) { collectMatches(); SEARCH.cur = Math.min(SEARCH.cur, SEARCH.matches.length - 1); updateSearchCount(); }
    markDirty();
    suggestCorrections(orig, newText);
  } else if (el.classList.contains('ts') || el.classList.contains('te')) {
    const v = parseTime(el.value);
    const key = el.classList.contains('ts') ? 'start' : 'end';
    if (v === null || (key === 'start' ? v >= seg.end : v <= seg.start)) { el.value = fmt(seg[key]); return; }
    if (Math.abs(v - seg[key]) < 0.01) return;
    snapshot();
    seg[key] = v;
    refreshSegRegion(seg);
    markDirty();
  }
});
list.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target.classList.contains('text') || e.target.matches('input'))) {
    e.preventDefault();
    e.target.blur();
  }
});

function suggestCorrections(orig, neu) {
  const clean = (w) => w.replace(/^[.,?!"'״׳:;()]+|[.,?!"'״׳:;()]+$/g, '');
  const a = orig.split(' '), b = neu.split(' ');
  if (a.length !== b.length) return;
  const pairs = [];
  for (let i = 0; i < a.length; i++) {
    const x = clean(a[i]), y = clean(b[i]);
    if (x && y && x !== y) pairs.push([x, y]);
  }
  if (!pairs.length || pairs.length > 3) return;
  toast(`לתקן מעכשיו תמיד: ${pairs.map(([x, y]) => `«${x}» ← «${y}»`).join(', ')} ?`, {
    timeout: 10000,
    actions: [{
      label: 'כן, תמיד', run: async () => {
        await api('/api/corrections/add', { method: 'POST', body: { pairs } });
        toast('נוסף למילון התיקונים');
      },
    }],
  });
}

function speakerMenu(seg, x, y) {
  const names = [...new Set([...speakersInProject(), ...(window.ENROLLED || [])])];
  const items = names.map((n) => ({
    html: `<span class="dot" style="background:${speakerColor(n)}"></span>${esc(n)}${n === seg.speaker ? ' ✓' : ''}`,
    run: () => setSpeaker(seg, n),
  }));
  items.push('-', {
    label: 'דובר חדש…', run: () => {
      const n = prompt('שם הדובר:');
      if (n && n.trim()) setSpeaker(seg, n.trim());
    },
  });
  showMenu(x, y, items);
}
function setSpeaker(seg, name) {
  if (seg.speaker === name) return;
  snapshot();
  seg.speaker = name;
  speakerColor(name);
  renderRow(seg); refreshSegRegion(seg); markDirty();
}

function caretOffsetIn(el) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return null;
  const r = document.createRange();
  r.selectNodeContents(el);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().length;
}
function splitSeg(seg) {
  const row = rowOf(seg.id);
  const el = row && $('.text', row);
  const off = el ? caretOffsetIn(el) : null;
  if (off === null) { splitAtPlayhead(); return; }   // no caret in the text -> split at the playhead
  const raw = el.textContent;
  const clean = (x) => x.replace(/\s+/g, ' ').trim();
  const before = clean(raw.slice(0, off)), after = clean(raw.slice(off));
  if (!before || !after) {
    toast('הסמן צריך להיות באמצע המשפט, עם טקסט משני צדדיו', { timeout: 5000 });
    return;
  }
  snapshot();
  const full = before + ' ' + after;
  const toks = full.split(' ');
  const k = before.split(' ').length;          // words that stay in the first sentence
  const hasWords = seg.words && seg.words.length === toks.length;
  let t;
  if (hasWords) t = (seg.words[k - 1].e + seg.words[k].s) / 2;
  else t = seg.start + (seg.end - seg.start) * before.length / (before.length + after.length);
  t = Math.min(seg.end - 0.01, Math.max(seg.start + 0.01, t));
  const w1 = hasWords ? seg.words.slice(0, k) : [];
  const w2 = hasWords ? seg.words.slice(k) : [];
  const second = { ...seg, id: uid(), start: +t.toFixed(3), text: after, words: w2 };
  seg.end = +t.toFixed(3); seg.text = before; seg.words = w1;
  P.segments.splice(P.segments.indexOf(seg) + 1, 0, second);
  renderAll(); selectSeg(second.id, false); markDirty();
  // like transcription tools: the caret moves to the start of the new line
  const nel = rowOf(second.id) && $('.text', rowOf(second.id));
  if (nel) {
    nel.focus();
    const r = document.createRange();
    r.setStart(nel, 0); r.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    nel.scrollIntoView({ block: 'nearest' });
  }
}
// Split at the playhead (like a video editor), on ALL tracks at once.
// First cut = start of the part, second cut = its end; then Delete removes everything between them.
function updateSplitBtn() {
  const b = $('#splitBtn');
  b.classList.toggle('on', cutStart !== null);
  b.textContent = cutStart !== null ? '✂ סוף הקטע' : '✂ פצל';
}
function clearCutGroup() {
  cutGroup.forEach((id) => rowOf(id)?.classList.remove('selected'));
  cutGroup.clear(); cutStart = null; cutRange = null;
  updateSplitBtn();
}
function cutSegAt(seg, t) {
  const toks = seg.text.split(' ').filter(Boolean);
  const hasWords = seg.words && seg.words.length === toks.length;
  const k = hasWords ? seg.words.filter((w) => (w.s + w.e) / 2 < t).length
    : Math.round(toks.length * (t - seg.start) / (seg.end - seg.start));
  const second = {
    ...seg, id: uid(), start: +t.toFixed(3), text: toks.slice(k).join(' '),
    words: hasWords ? seg.words.slice(k) : [],
  };
  seg.words = hasWords ? seg.words.slice(0, k) : [];
  seg.end = +t.toFixed(3); seg.text = toks.slice(0, k).join(' ');
  P.segments.splice(P.segments.indexOf(seg) + 1, 0, second);
  return second;
}
// Works anywhere on the timeline (inside a sentence or in a silence). Press once at the start of the
// part, once at its end; then Delete removes everything between the two points on ALL tracks.
function splitAtPlayhead() {
  const t = +video.currentTime.toFixed(3);
  const secondCut = cutStart !== null && t > cutStart + 0.05;
  snapshot();
  const hits = P.segments.filter((s) => !s.deleted && t > s.start + 0.05 && t < s.end - 0.05);
  hits.forEach((s) => cutSegAt(s, t));
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const prevStart = cutStart;
  clearCutGroup();
  if (secondCut) {
    const a = prevStart - 0.002, b = t + 0.002;
    P.segments.forEach((s) => { if (!s.deleted && s.start >= a && s.end <= b) cutGroup.add(s.id); });
    cutRange = { start: prevStart, end: t };
  } else {
    cutStart = t;
  }
  updateSplitBtn();
  renderAll();
  cutGroup.forEach((id) => rowOf(id)?.classList.add('selected'));
  const first = [...cutGroup].map(segById).filter(Boolean).sort((x, y) => x.start - y.start)[0];
  if (first) { selectedId = first.id; rowOf(first.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  markDirty();
  toast(secondCut ? `הקטע ${fmt(cutRange.start)}–${fmt(cutRange.end)} מסומן בכל השורות. לחץ Delete כדי למחוק אותו`
    : `סימנתי תחילת קטע ב־${fmt(t)}. עכשיו עבור לסוף הקטע ולחץ ✂ שוב`, { timeout: 5000 });
}
function deleteCutGroup() {
  snapshot();
  const n = cutGroup.size, range = cutRange;
  cutGroup.forEach((id) => { const s = segById(id); if (s) s.deleted = true; });
  if (range) P.cuts.push({ id: uid(), start: range.start, end: range.end, kind: 'manual', active: true });
  cutGroup.clear(); cutStart = null; cutRange = null;
  updateSplitBtn();
  renderAll(); markDirty();
  toast(range ? `הקטע ${fmt(range.start)}–${fmt(range.end)} נמחק מכל השורות` : `נמחקו ${n} משפטים`,
    { actions: [{ label: 'בטל', run: undo }] });
}
function mergeSeg(seg) {
  const i = P.segments.indexOf(seg);
  const next = P.segments.slice(i + 1).find((s) => (P.tracks?.length ? s.track === seg.track : true));
  if (!next) return;
  snapshot();
  seg.end = Math.max(seg.end, next.end);
  seg.text = (seg.text + ' ' + next.text).trim();
  seg.words = [...(seg.words || []), ...(next.words || [])];
  P.segments = P.segments.filter((s) => s !== next);
  renderAll(); selectSeg(seg.id, false); markDirty();
}

// ------------------------------------------------------------------ set start / end from playhead
function setEdge(seg, key) {
  const t = +video.currentTime.toFixed(3);
  if (key === 'start' && t >= seg.end - 0.05) {
    toast(`ההתחלה חייבת להיות לפני סוף המשפט (${fmt(seg.end)}). הזז את הניגון למקום הנכון ונסה שוב.`, { error: true });
    return;
  }
  if (key === 'end' && t <= seg.start + 0.05) {
    toast(`הסוף חייב להיות אחרי תחילת המשפט (${fmt(seg.start)}). הזז את הניגון למקום הנכון ונסה שוב.`, { error: true });
    return;
  }
  snapshot();
  seg[key] = t;
  const i = P.segments.indexOf(seg);
  const outOfOrder = (i > 0 && P.segments[i - 1].start > seg.start) || (i < P.segments.length - 1 && P.segments[i + 1].start < seg.start);
  if (outOfOrder) renderAll();
  else { refreshSegRegion(seg); renderRow(seg); }
  selectSeg(seg.id, false);
  const inp = $(key === 'start' ? '.ts' : '.te', rowOf(seg.id));
  if (inp) { inp.classList.add('flash'); setTimeout(() => inp.classList.remove('flash'), 900); }
  markDirty();
}

// ------------------------------------------------------------------ search & replace
let SEARCH = { re: null, matches: [], cur: -1 };

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function buildSearchRe() {
  const q = $('#search').value.trim();
  if (!q) return null;
  const body = escRe(q);
  return $('#wholeWord').checked
    ? new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, 'gu')
    : new RegExp(body, 'gu');
}
function matchesIn(text, re) {
  const out = [];
  if (!re) return out;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    out.push({ idx: m.index, len: m[0].length });
    if (!m[0].length) re.lastIndex++;
  }
  return out;
}
function highlight(seg) {
  const re = SEARCH.re;
  const ms = matchesIn(seg.text, re);
  if (!ms.length) return esc(seg.text);
  const cur = SEARCH.matches[SEARCH.cur];
  let html = '', pos = 0;
  for (const m of ms) {
    const isCur = cur && cur.id === seg.id && cur.idx === m.idx;
    html += esc(seg.text.slice(pos, m.idx)) + `<mark${isCur ? ' class="cur"' : ''}>${esc(seg.text.substr(m.idx, m.len))}</mark>`;
    pos = m.idx + m.len;
  }
  return html + esc(seg.text.slice(pos));
}
function collectMatches() {
  SEARCH.matches = [];
  if (!SEARCH.re) return;
  for (const s of P.segments) for (const m of matchesIn(s.text, SEARCH.re)) SEARCH.matches.push({ id: s.id, ...m });
}
function updateSearchCount() {
  const n = SEARCH.matches.length;
  $('#searchCount').textContent = !SEARCH.re ? '' : n ? `${SEARCH.cur + 1} מתוך ${n}` : 'לא נמצא';
  $('#searchCount').classList.toggle('none', !!SEARCH.re && !n);
}
function applySearch() {
  if (!P) return;
  const only = $('#onlyMatches').checked && SEARCH.re;
  $$('.seg', list).forEach((row) => {
    const seg = segById(row.dataset.id);
    row.classList.toggle('hidden', !!only && !matchesIn(seg.text, SEARCH.re).length);
  });
}
function runSearch() {
  if (!P) return;
  SEARCH.re = buildSearchRe();
  collectMatches();
  // start from the first result at or after the current playback point
  const t = video.currentTime;
  SEARCH.cur = SEARCH.matches.length ? Math.max(0, SEARCH.matches.findIndex((m) => segById(m.id).end >= t)) : -1;
  renderList();
  updateSearchCount();
  const m = SEARCH.matches[SEARCH.cur];
  if (m) rowOf(m.id)?.scrollIntoView({ block: 'center' });
}
function gotoMatch(step) {
  const n = SEARCH.matches.length;
  if (!n) return;
  const prev = SEARCH.matches[SEARCH.cur];
  SEARCH.cur = (SEARCH.cur + step + n) % n;
  const m = SEARCH.matches[SEARCH.cur];
  if (prev) renderRow(segById(prev.id));
  renderRow(segById(m.id));
  updateSearchCount();
  selectSeg(m.id, true);
  stopAt = null;
  video.currentTime = segById(m.id).start;
}
function retokenizeWords(seg) {
  const toks = seg.text.split(' ');
  if (seg.words && seg.words.length === toks.length) seg.words.forEach((w, i) => { w.w = toks[i]; });
}
function replaceOne() {
  const m = SEARCH.matches[SEARCH.cur];
  if (!m) { toast('אין תוצאה מסומנת להחלפה'); return; }
  const seg = segById(m.id);
  const rep = $('#replaceWith').value;
  snapshot();
  seg.text = (seg.text.slice(0, m.idx) + rep + seg.text.slice(m.idx + m.len)).replace(/\s+/g, ' ').trim();
  retokenizeWords(seg);
  refreshSegRegion(seg);
  const keep = SEARCH.cur;
  collectMatches();
  SEARCH.cur = SEARCH.matches.length ? Math.min(keep, SEARCH.matches.length - 1) : -1;
  renderRow(seg);
  const next = SEARCH.matches[SEARCH.cur];
  if (next && next.id !== seg.id) { renderRow(segById(next.id)); selectSeg(next.id, true); video.currentTime = segById(next.id).start; }
  updateSearchCount();
  markDirty();
}
function replaceAll() {
  if (!SEARCH.re || !SEARCH.matches.length) { toast('אין תוצאות להחלפה'); return; }
  const rep = $('#replaceWith').value;
  const q = $('#search').value.trim();
  const count = SEARCH.matches.length;
  snapshot();
  for (const seg of P.segments) {
    SEARCH.re.lastIndex = 0;
    if (!SEARCH.re.test(seg.text)) continue;
    SEARCH.re.lastIndex = 0;
    seg.text = seg.text.replace(SEARCH.re, () => rep).replace(/\s+/g, ' ').trim();
    retokenizeWords(seg);
  }
  collectMatches();
  SEARCH.cur = SEARCH.matches.length ? 0 : -1;
  renderRegions();
  renderList();
  updateSearchCount();
  markDirty();
  const actions = [{ label: 'בטל', run: () => { undo(); runSearch(); } }];
  if (rep.trim() && !/\s/.test(q)) {
    actions.push({
      label: 'תקן תמיד', run: async () => {
        await api('/api/corrections/add', { method: 'POST', body: { pairs: [[q, rep.trim()]] } });
        toast('נוסף למילון התיקונים – יתוקן אוטומטית גם בתמלולים הבאים');
      },
    });
  }
  toast(`הוחלפו ${count} מופעים של «${q}» ב«${rep}»`, { timeout: 12000, actions });
}

$('#search').oninput = () => { clearTimeout(runSearch.t); runSearch.t = setTimeout(runSearch, 200); };
$('#search').onkeydown = (e) => {
  if (e.key === 'Enter') { e.preventDefault(); clearTimeout(runSearch.t); if (!SEARCH.re) runSearch(); gotoMatch(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { $('#search').value = ''; runSearch(); }
};
$('#searchNext').onclick = () => gotoMatch(1);
$('#searchPrev').onclick = () => gotoMatch(-1);
$('#wholeWord').onchange = runSearch;
$('#onlyMatches').onchange = applySearch;
$('#toggleReplace').onclick = () => {
  const row = $('#replaceRow');
  row.classList.toggle('hidden');
  $('#toggleReplace').classList.toggle('on', !row.classList.contains('hidden'));
  if (!row.classList.contains('hidden')) ($('#search').value ? $('#replaceWith') : $('#search')).focus();
};
$('#replaceOne').onclick = replaceOne;
$('#replaceAll').onclick = replaceAll;
$('#replaceWith').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } };

// ------------------------------------------------------------------ playback loop
function loop() {
  const t = video.currentTime;
  const playing = !video.paused;

  if (playing && stopAt !== null && t >= stopAt) { video.pause(); stopAt = null; }
  if (playing && $('#previewCuts').checked) {
    for (const [a, b] of removed) {
      if (t >= a && t < b - 0.02) { video.currentTime = b + 0.01; break; }
      if (a > t) break;
    }
  }
  // cursors on the speech lanes
  for (const l of lanes) l.ws.setTime(t);
  updateLaneCursor(t);

  // active sentence + subtitle
  let cur = [];
  for (const s of P.segments) {
    if (s.start > t) break;
    if (t <= s.end && !s.deleted) cur.push(s);
  }
  const top = cur[cur.length - 1];
  const id = top ? top.id : null;
  if (id !== activeId) {
    if (activeId) rowOf(activeId)?.classList.remove('active');
    activeId = id;
    const row = id && rowOf(id);
    if (row) {
      row.classList.add('active');
      if (playing && $('#followPlay').checked && document.activeElement?.closest?.('.seg') !== row) {
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }
  const multi = new Set(cur.map((s) => s.speaker)).size > 1;
  const html = cur.slice(-2).map((s) => (multi ? `<span class="who">${esc(s.speaker)}</span>` : '') + esc(s.text)).join('<br>');
  if ($('#subtitle').dataset.h !== html) { $('#subtitle').innerHTML = html; $('#subtitle').dataset.h = html; }

  $('#clock').textContent = `${fmt(t)} / ${fmt(P.duration, false)}`;
  $('#playBtn').textContent = playing ? '❚❚' : '▶';
  rafId = requestAnimationFrame(loop);
}

function updateLaneCursor(t) {
  const cur = $('#laneCursor');
  const host = $('#trackLanes');
  if (!wsMain || !host.offsetHeight) { cur.style.display = 'none'; return; }
  const width = wsMain.getWrapper().scrollWidth;
  const x = (t / P.duration) * width - wsMain.getScroll();
  const visible = $('#wave-main').clientWidth;
  if (x < 0 || x > visible) { cur.style.display = 'none'; return; }
  cur.style.display = 'block';
  cur.style.left = x + 'px';
  cur.style.top = host.offsetTop + 'px';
  cur.style.height = host.offsetHeight + 'px';
}

// ------------------------------------------------------------------ transport
$('#playBtn').onclick = () => { stopAt = null; video.paused ? video.play() : video.pause(); };
$('#back5').onclick = () => { video.currentTime = Math.max(0, video.currentTime - 5); };
$('#fwd5').onclick = () => { video.currentTime = Math.min(P.duration, video.currentTime + 5); };
// speed: kept on the video element at all times – across cut skips, seeks, sentence playback and project reloads
function currentSpeed() { return +$('#speed').value || 1; }
function applySpeed() {
  const r = currentSpeed();
  video.defaultPlaybackRate = r;
  if (Math.abs(video.playbackRate - r) > 0.001) video.playbackRate = r;
  video.preservesPitch = true;  // slow speech stays at natural pitch
}
$('#speed').onchange = () => {
  applySpeed();
  try { localStorage.setItem('tamlul.speed', $('#speed').value); } catch (_) { /* */ }
};
['loadedmetadata', 'play', 'seeked', 'ratechange'].forEach((ev) => video.addEventListener(ev, applySpeed));
try {
  const saved = localStorage.getItem('tamlul.speed');
  if (saved && $(`#speed option[value="${saved}"]`)) $('#speed').value = saved;
} catch (_) { /* */ }
applySpeed();
$('#zoom').oninput = (e) => {
  const v = +e.target.value;
  [wsMain, ...lanes.map((l) => l.ws)].forEach((w) => w && w.zoom(v));
};
$('#projName').onchange = (e) => { P.name = e.target.value.trim() || P.name; markDirty(); };
$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
$('#splitBtn').onclick = () => splitAtPlayhead();

document.addEventListener('keydown', (e) => {
  if ($('#editor').classList.contains('hidden')) return;
  const editing = e.target.closest('input, textarea, select, [contenteditable]');
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyH') {
    e.preventDefault();
    if ($('#replaceRow').classList.contains('hidden')) $('#toggleReplace').click(); else $('#replaceWith').focus();
    return;
  }
  if (!editing && !e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'KeyS') {
    e.preventDefault(); splitAtPlayhead(); return;
  }
  if (!editing && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
    // [ = start, ] = end, for the selected sentence (or the one playing)
    const seg = segById(selectedId) || segById(activeId);
    if (seg) { e.preventDefault(); setEdge(seg, e.code === 'BracketLeft' ? 'start' : 'end'); }
    return;
  }
  if (e.code === 'Space' && !editing) {
    e.preventDefault();
    stopAt = null;
    video.paused ? video.play() : video.pause();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editing) {
    e.preventDefault(); undo();
  } else if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') && !editing) {
    e.preventDefault(); redo();
  } else if ((e.key === 'Delete') && !editing && (cutGroup.size || cutRange)) {
    e.preventDefault(); deleteCutGroup();
  } else if ((e.key === 'Delete') && !editing && selectedId) {
    const seg = segById(selectedId);
    snapshot(); seg.deleted = !seg.deleted; renderRow(seg); refreshSegRegion(seg); markDirty();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault(); dirty = true; saveNow();
  }
});

// ------------------------------------------------------------------ cuts toolbar
async function suggest(kind) {
  dirty = true;
  await saveNow();
  const body = kind === 'silence' ? { silence: true } : { fillers: true };
  const { cuts } = await api(`/api/projects/${P.id}/suggest`, { method: 'POST', body });
  snapshot();
  P.cuts = P.cuts.filter((c) => c.kind !== kind).concat(cuts);
  renderRegions();
  markDirty();
  const sec = cuts.reduce((a, c) => a + c.end - c.start, 0);
  if (!cuts.length) toast(kind === 'silence' ? 'לא נמצאו הפסקות ארוכות' : 'לא נמצאו מילות מילוי');
  else toast(`${kind === 'silence' ? 'הפסקות' : 'מילות מילוי'}: סומנו ${cuts.length} קטעים (${fmt(sec)}). אדום = יימחק. לחיצה כפולה על קטע מבטלת אותו.`, {
    timeout: 9000, actions: [{ label: 'בטל', run: undo }],
  });
}
$('#suggestSilence').onclick = () => suggest('silence');
$('#suggestFillers').onclick = () => suggest('filler');
$('#clearCuts').onclick = () => {
  if (!P.cuts.length) return;
  snapshot();
  P.cuts = [];
  renderRegions();
  markDirty();
  toast('כל החיתוכים הוסרו', { actions: [{ label: 'בטל', run: undo }] });
};
$('#cutMode').onclick = () => {
  cutMode = !cutMode;
  $('#cutMode').classList.toggle('on', cutMode);
  if (cutMode) {
    unsubDrag = regMain.enableDragSelection({ color: CUT_COLOR });
    toast('גרור על גל הסאונד העליון כדי לסמן קטע למחיקה. לחיצה כפולה על קטע אדום מבטלת אותו.', { timeout: 7000 });
  } else if (unsubDrag) { unsubDrag(); unsubDrag = null; }
};
$('#previewCuts').onchange = () => {
  if ($('#previewCuts').checked) toast('בזמן הניגון, הקטעים המסומנים לחיתוך ידולגו – כך שומעים את התוצאה.');
};
$('#applyCorrections').onclick = async () => {
  dirty = true;
  await saveNow();
  snapshot();
  const r = await api(`/api/projects/${P.id}/apply_corrections`, { method: 'POST' });
  P.segments = r.segments;
  renderAll();
  toast(r.changed ? `תוקנו ${r.changed} משפטים` : 'לא נמצאו מילים לתיקון');
};

// ------------------------------------------------------------------ speakers modal
$('#speakersBtn').onclick = async () => {
  window.ENROLLED = await api('/api/speakers');
  const names = speakersInProject();
  const count = (n) => P.segments.filter((s) => s.speaker === n).length;
  openModal(`<h2>דוברים</h2>
    <p class="hint">שנה שם כדי לעדכן את כל המשפטים של אותו דובר. "זכור קול" שומר את הקול, כך שבהקלטות הבאות התוכנה תזהה אותו בשם.</p>
    ${names.map((n, i) => `<div class="sp-row">
      <span class="dot" style="background:${speakerColor(n)}"></span>
      <input data-i="${i}" value="${esc(n)}">
      <span class="hint">${count(n)} משפטים</span>
      <button class="btn small" data-enroll="${i}" ${window.ENROLLED.includes(n) ? 'title="הקול כבר שמור – לחיצה תשפר אותו"' : ''}>🎤 ${window.ENROLLED.includes(n) ? 'שפר קול' : 'זכור קול'}</button>
    </div>`).join('')}`);
  $$('#modalBody [data-i]').forEach((inp) => {
    inp.onchange = () => {
      const old = names[+inp.dataset.i], neu = inp.value.trim();
      if (!neu || neu === old) return;
      snapshot();
      P.segments.forEach((s) => { if (s.speaker === old) s.speaker = neu; });
      if (P.speaker_colors[old]) { P.speaker_colors[neu] = P.speaker_colors[old]; delete P.speaker_colors[old]; }
      names[+inp.dataset.i] = neu;
      renderAll(); markDirty();
    };
  });
  $$('#modalBody [data-enroll]').forEach((b) => {
    b.onclick = async () => {
      const name = names[+b.dataset.enroll];
      if (/^דובר \d+$/.test(name)) { toast('קודם תן לדובר שם אמיתי (בתיבה), ואז לחץ "זכור קול"', { error: true }); return; }
      dirty = true; await saveNow();
      closeModal();
      try {
        await api(`/api/projects/${P.id}/enroll`, { method: 'POST', body: { label: name, name } });
        const j = await watchJob(P.id, { title: `לומד את הקול של ${name}…` });
        if (j.state === 'done') toast(`הקול של ${name} נשמר. בהקלטות הבאות הוא יזוהה אוטומטית.`);
      } catch (e) { toast(e.message, { error: true }); }
    };
  });
};

// ------------------------------------------------------------------ export
$('#exportBtn').onclick = () => {
  const hasCuts = removed.length > 0;
  const tracksOpt = P.tracks?.length && !P.main.is_mix;
  openModal(`<h2>ייצוא</h2>
    <div class="export-grid">
      <button class="btn primary" data-k="video">🎬 ${P.main.has_video ? 'וידאו ערוך' : 'אודיו ערוך'}<small>בלי הקטעים שנחתכו, יחד עם קובץ כתוביות מותאם</small></button>
      <button class="btn" data-k="srt">💬 כתוביות SRT<small>לטעינה בעורך הווידאו</small></button>
      <button class="btn" data-k="docx">📄 מסמך Word<small>תמלול מסודר לפי דוברים</small></button>
      <button class="btn" data-k="txt">📝 קובץ טקסט<small>טקסט פשוט</small></button>
    </div>
    <h3>אפשרויות</h3>
    <label class="check"><input type="checkbox" id="exEdited" ${hasCuts ? '' : 'disabled'}> כתוביות / Word לפי הגרסה הערוכה (זמנים אחרי החיתוך)</label><br>
    ${tracksOpt ? '<label class="check"><input type="checkbox" id="exTracks"> בווידאו הערוך – להשתמש בערוצי האודיו הנפרדים במקום בסאונד של הווידאו</label><br>' : ''}
    ${hasCuts ? '' : '<p class="hint">עדיין לא סומנו חיתוכים – הווידאו "הערוך" יהיה זהה למקור.</p>'}
    <div class="row" style="margin-top:1rem"><button class="btn ghost" id="openExports">📂 פתח את תיקיית הייצוא</button></div>`);
  $('#openExports').onclick = () => api('/api/open_folder', { method: 'POST', body: {} });
  $$('#modalBody [data-k]').forEach((b) => {
    b.onclick = async () => {
      const kind = b.dataset.k;
      dirty = true; await saveNow();
      const body = { kind, edited: $('#exEdited')?.checked, use_tracks: $('#exTracks')?.checked };
      closeModal();
      try {
        const r = await api(`/api/projects/${P.id}/export`, { method: 'POST', body });
        if (kind === 'video') {
          const j = await watchJob(P.id, { title: 'מייצא…', hideable: true });
          if (j.state === 'done') doneToast(j.result, j.message);
        } else doneToast(r, 'הקובץ נשמר');
      } catch (e) { toast(e.message, { error: true, timeout: 12000 }); }
    };
  });
};
function doneToast(r, msg) {
  toast(`${msg}: ${r.file.split(/[\\/]/).pop()}`, {
    timeout: 15000,
    actions: [{ label: 'פתח תיקייה', run: () => api('/api/open_folder', { method: 'POST', body: { folder: r.folder } }) }],
  });
}

// ------------------------------------------------------------------ AI assistant
let AI = null;          // {has_key, masked, model, models, spent, keys_url, billing_url}
let aiCtrl = null;      // AbortController of the running request

async function loadAI() {
  try { AI = await api('/api/ai'); } catch (_) { AI = null; }
  return AI;
}
function aiModelLabel() {
  const m = AI && AI.models.find((x) => x.id === AI.model);
  return m ? m.label.split(' – ')[0] : '';
}
function openConsole(which) {
  if (!AI) return;
  openExternal(which === 'billing' ? AI.billing_url : AI.keys_url);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-url]');
  if (b) { e.preventDefault(); openConsole(b.dataset.url); }
});

function showTab(name) {
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $('#tabTranscript').classList.toggle('hidden', name !== 'transcript');
  $('#tabAI').classList.toggle('hidden', name !== 'ai');
  try { localStorage.setItem('tamlul.tab', name); } catch (_) { /* */ }
  if (name === 'ai') renderAITab();
}
$$('.tab').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

async function renderAITab() {
  if (!AI) await loadAI();
  if (!AI) return;
  $('#aiSetup').classList.toggle('hidden', AI.has_key);
  $('#aiMain').classList.toggle('hidden', !AI.has_key);
  $('#aiModel').textContent = `${aiModelLabel()} · הוצאה עד היום ≈ $${(AI.spent || 0).toFixed(2)}`;
  const hasCuts = P && removed.length > 0;
  $('#aiEditedWrap').classList.toggle('hidden', !hasCuts);
  if (P && !$('#aiChat').dataset.pid) renderChat();
}

// --- tiny, safe markdown renderer (escape first, then format)
function tsToSec(s) { return s.split(':').reduce((a, v) => a * 60 + +v, 0); }
function inline(s, edited) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\[?\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b\]?/g,
      (m, ts) => `<a class="ts-link" href="#" data-t="${tsToSec(ts)}" data-edited="${edited ? 1 : 0}" title="קפוץ לרגע הזה">${ts}</a>`);
}
function md(text, edited) {
  const lines = esc(text).split('\n');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const l = raw.trimEnd();
    let m;
    if (!l.trim()) { close(); continue; }
    if ((m = l.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1], edited)}</h4>`; continue; }
    if ((m = l.match(/^\s*[-*•]\s+(.*)/))) {
      if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(m[1], edited)}</li>`; continue;
    }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(m[1], edited)}</li>`; continue;
    }
    close();
    html += `<p>${inline(l, edited)}</p>`;
  }
  close();
  return html;
}

// edited-timeline time -> original time (to seek the video)
function editedToOriginal(t) {
  let shift = 0;
  for (const [a, b] of removed) {
    if (a - shift <= t) shift += b - a;
    else break;
  }
  return t + shift;
}

function msgEl(m) {
  const el = document.createElement('div');
  el.className = 'ai-msg ' + m.role;
  if (m.role === 'user') {
    el.innerHTML = `<div class="bubble">${esc(m.label || m.content)}</div>`;
  } else {
    el.innerHTML = `<div class="answer">${md(m.content || '', m.edited)}</div>
      <div class="ai-foot">
        <span class="hint">${m.cost != null ? `עלות ≈ $${m.cost.toFixed(3)}` : ''}${m.edited ? ' · זמנים לפי הגרסה הערוכה' : ''}</span>
        <div class="spacer"></div>
        <button class="btn small ghost" data-act="copy">📋 העתק</button>
        <button class="btn small ghost" data-act="save">💾 שמור לקובץ</button>
      </div>`;
    el._text = m.content || '';
  }
  return el;
}
function renderChat() {
  const box = $('#aiChat');
  box.dataset.pid = P.id;
  box.innerHTML = '';
  const chat = P.ai_chat || [];
  if (!chat.length) {
    box.innerHTML = `<div class="ai-empty">בחר פעולה למעלה או שאל שאלה על ההקלטה.<br>
      למשל: "על מה דיברו בחצי השעה הראשונה?" או "איפה הוזכר פרקינסון?"<br>
      <span class="hint">לחיצה על זמן בתשובה מקפיצה את הווידאו לאותו רגע.</span></div>`;
    return;
  }
  for (const m of chat) box.appendChild(msgEl(m));
  box.scrollTop = box.scrollHeight;
}

$('#aiChat').addEventListener('click', async (e) => {
  const a = e.target.closest('.ts-link');
  if (a) {
    e.preventDefault();
    let t = +a.dataset.t;
    if (a.dataset.edited === '1') t = editedToOriginal(t);
    stopAt = null;
    video.currentTime = Math.min(t, P.duration);
    const seg = P.segments.find((s) => s.start <= t + 0.5 && s.end >= t) || P.segments.find((s) => s.start >= t);
    if (seg) selectSeg(seg.id, false);
    return;
  }
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const msg = btn.closest('.ai-msg');
  const text = msg._text || '';
  if (btn.dataset.act === 'copy') {
    try { await navigator.clipboard.writeText(text); toast('הועתק – אפשר להדביק ביוטיוב, בוואטסאפ או במסמך'); } catch (_) { toast('ההעתקה נכשלה', { error: true }); }
  } else if (btn.dataset.act === 'save') {
    const label = msg.previousElementSibling?.querySelector('.bubble')?.textContent || 'AI';
    const r = await api(`/api/projects/${P.id}/ai/save`, { method: 'POST', body: { text, name: label.slice(0, 40) } });
    doneToast(r, 'נשמר');
  }
});

function setBusy(b) {
  $('#aiSend').classList.toggle('hidden', b);
  $('#aiStop').classList.toggle('hidden', !b);
  $$('.ai-actions .btn').forEach((x) => { x.disabled = b; });
}

async function aiAsk({ preset = null, question = null, label }) {
  if (aiCtrl) return;
  if (!AI || !AI.has_key) { showTab('ai'); return; }
  dirty = true;
  await saveNow();  // the server reads the latest corrections from disk
  const box = $('#aiChat');
  if (!(P.ai_chat || []).length) box.innerHTML = '';
  const edited = removed.length > 0 && $('#aiEdited').checked;
  box.appendChild(msgEl({ role: 'user', label: label || question, content: question || '' }));
  const ans = msgEl({ role: 'assistant', content: '', edited });
  $('.answer', ans).innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  $('.ai-foot', ans).classList.add('hidden');
  box.appendChild(ans);
  box.scrollTop = box.scrollHeight;
  setBusy(true);
  aiCtrl = new AbortController();
  let text = '', painted = false, finished = null, failed = null;
  const paint = () => {
    painted = false;
    $('.answer', ans).innerHTML = md(text, edited);
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (nearBottom) box.scrollTop = box.scrollHeight;
  };
  try {
    const r = await fetch(`${API}/api/projects/${P.id}/ai`, {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ preset, question, label, edited }), signal: aiCtrl.signal,
    });
    if (!r.ok) {
      let msg = `שגיאה ${r.status}`;
      try { msg = (await r.json()).error || msg; } catch (_) { /* */ }
      throw Object.assign(new Error(msg), { kind: 'error' });
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const ev = JSON.parse(line);
        if (ev.t) { text += ev.t; if (!painted) { painted = true; requestAnimationFrame(paint); } }
        else if (ev.done) finished = ev;
        else if (ev.error) failed = ev;
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') failed = { error: err.message, kind: err.kind || 'error' };
  }
  aiCtrl = null;
  setBusy(false);
  paint();
  ans._text = text;
  if (failed) {
    const extra = failed.kind === 'credit' ? '<button class="btn small" data-url="billing">קניית קרדיטים ↗</button>'
      : failed.kind === 'key' ? '<button class="btn small" id="aiFixKey">הגדרת מפתח</button>' : '';
    $('.answer', ans).insertAdjacentHTML('beforeend', `<div class="ai-error">⚠ ${esc(failed.error)} ${extra}</div>`);
    $('#aiFixKey')?.addEventListener('click', openSettings);
    return;
  }
  if (!finished) {
    $('.answer', ans).insertAdjacentHTML('beforeend', '<div class="ai-error">⏹ נעצר. התשובה החלקית לא נשמרה.</div>');
    return;
  }
  P.ai_chat = P.ai_chat || [];
  P.ai_chat.push({ role: 'user', content: question || '', label: label || question },
    { role: 'assistant', content: text, edited: finished.edited, cost: finished.cost });
  AI.spent = finished.spent;
  $('#aiModel').textContent = `${aiModelLabel()} · הוצאה עד היום ≈ $${(AI.spent || 0).toFixed(2)}`;
  $('.ai-foot', ans).classList.remove('hidden');
  $('.ai-foot .hint', ans).textContent = `עלות ≈ $${finished.cost.toFixed(3)}${finished.edited ? ' · זמנים לפי הגרסה הערוכה' : ''}`;
  if (finished.truncated) $('.answer', ans).insertAdjacentHTML('beforeend', '<div class="ai-error">התשובה נקטעה כי היא ארוכה מדי. בקש "המשך".</div>');
}

$$('.ai-actions [data-preset]').forEach((b) => {
  b.onclick = () => aiAsk({ preset: b.dataset.preset, label: b.textContent.trim() });
});
$('#aiForm').onsubmit = (e) => {
  e.preventDefault();
  const q = $('#aiInput').value.trim();
  if (!q) return;
  $('#aiInput').value = '';
  aiAsk({ question: q, label: q });
};
$('#aiInput').onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiForm').requestSubmit(); }
};
$('#aiStop').onclick = () => { if (aiCtrl) aiCtrl.abort(); };
$('#aiClear').onclick = async () => {
  if (!(P.ai_chat || []).length) return;
  if (!confirm('למחוק את כל השיחה עם העוזר בפרויקט הזה?')) return;
  await api(`/api/projects/${P.id}/ai`, { method: 'DELETE' });
  P.ai_chat = [];
  renderChat();
};
async function saveKeyAndTest(key) {
  key = (key || '').trim();
  if (!key.startsWith('sk-ant-')) { toast('המפתח צריך להתחיל ב-sk-ant-', { error: true }); return false; }
  AI = await api('/api/ai', { method: 'POST', body: { key } });
  const t = toast('בודק את המפתח…', { timeout: 0 });
  const r = await api('/api/ai/test', { method: 'POST' });
  t.remove();
  if (r.ok) { toast('✓ החיבור ל-Claude עובד'); renderAITab(); return true; }
  if (r.kind === 'key') AI = await api('/api/ai', { method: 'POST', body: { clear_key: true } });
  toast(r.error, {
    error: true, timeout: 15000,
    actions: r.kind === 'credit' ? [{ label: 'קניית קרדיטים', run: () => openConsole('billing') }] : [],
  });
  return r.kind === 'credit';  // key itself is fine
}
$('#aiRecheck').onclick = async () => {
  await loadAI();
  if (!AI.has_key) { toast('לא נמצא מפתח בקובץ ‎.env. ודא שהשורה היא ANTHROPIC_API_KEY=sk-ant-... ושהקובץ נשמר.', { error: true, timeout: 9000 }); return; }
  const r = await api('/api/ai/test', { method: 'POST' });
  if (r.ok) toast('✓ המפתח מהקובץ עובד');
  else toast(r.error, { error: true, timeout: 12000, actions: r.kind === 'credit' ? [{ label: 'קניית קרדיטים', run: () => openConsole('billing') }] : [] });
  renderAITab();
};
$('#aiKeySave').onclick = async () => {
  if (await saveKeyAndTest($('#aiKeySetup').value)) { $('#aiKeySetup').value = ''; renderAITab(); }
};

// ------------------------------------------------------------------ start
(async function init() {
  renderNewProject();
  try { await connectEngine(); } catch (e) { ENGINE_ERROR = 'engine_info: ' + e; }
  try { await waitForEngine(); } catch (_) { return; }
  try { await loadSettings(); } catch (e) { toast('לא מצליח להתחבר לתוכנה: ' + e.message, { error: true }); }
  window.ENROLLED = await api('/api/speakers').catch(() => []);
  await loadAI();
  try { if (localStorage.getItem('tamlul.tab') === 'ai') showTab('ai'); } catch (_) { /* */ }
  const pid = location.hash.slice(1);
  if (pid) openProject(pid).catch(() => showHome());
  else showHome();
})();
