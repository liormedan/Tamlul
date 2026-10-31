// First-run setup wizard. The Tauri shell (src-tauri/src/setup.rs) does the work and
// reports each step as a `setup-progress` event; this page only shows it.
'use strict';

const TAURI = window.__TAURI__;
const $ = (s) => document.querySelector(s);
const invoke = (cmd, args) => TAURI.core.invoke(cmd, args);

let STEPS = [];
let current = -1;
let startedAt = 0;
let timer = null;
const logLines = [];

const gb = (b) => (b / 1024 ** 3).toFixed(1) + 'GB';
const mb = (b) => b >= 1024 ** 3 ? gb(b) : Math.round(b / 1024 ** 2) + 'MB';

function renderSteps() {
  $('#suSteps').innerHTML = STEPS.map((title, i) =>
    `<li data-i="${i}"><span class="mark"></span><span class="title"></span><span class="note"></span></li>`).join('');
  STEPS.forEach((title, i) => { $(`#suSteps li[data-i="${i}"] .title`).textContent = title; });
}

function setStep(i, state, note) {
  const li = $(`#suSteps li[data-i="${i}"]`);
  if (!li) return;
  li.className = state;
  if (note !== undefined) li.querySelector('.note').textContent = note;
}

function markRunning(i) {
  for (let k = 0; k < i; k++) setStep(k, 'done', '');
  current = i;
  setStep(i, 'running', '');
  $('#suBarWrap').classList.remove('hidden');
  $('#suBar').className = 'indeterminate';
  $('#suBar').style.width = '';
}

function tick() {
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $('#suElapsed').textContent = `זמן שעבר ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function setBusy(busy) {
  $('#suStart').classList.toggle('hidden', busy);
  if (busy) {
    $('#suError').classList.add('hidden');
    if (!startedAt) startedAt = Date.now();
    clearInterval(timer);
    timer = setInterval(tick, 1000);
    tick();
  } else {
    clearInterval(timer);
  }
}

function addLog(line) {
  logLines.push(line);
  if (logLines.length > 600) logLines.splice(0, 200);
  const pre = $('#suLog');
  if (!pre.classList.contains('hidden')) {
    pre.textContent = logLines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  }
}

function deviceText(result) {
  if (result && result.device === 'cuda') return `התמלול ירוץ על כרטיס המסך${result.gpu ? ': ' + result.gpu : ''}.`;
  return 'לא נמצא כרטיס מסך של NVIDIA שאפשר להשתמש בו, ולכן התמלול ירוץ על המעבד. זה עובד, אבל לאט יותר. עדכון מנהל ההתקן של NVIDIA בדרך כלל פותר את זה.';
}

function onProgress(ev) {
  switch (ev.kind) {
    case 'step':
      markRunning(ev.step);
      $('#suLine').textContent = '';
      addLog(`--- ${STEPS[ev.step]}`);
      break;
    case 'line':
      $('#suLine').textContent = ev.line;
      addLog(ev.line);
      break;
    case 'size': {
      if (ev.step !== current) break;
      if (ev.expected) {
        const pct = Math.min(99, Math.round(100 * ev.bytes / ev.expected));
        $('#suBar').className = '';
        $('#suBar').style.width = pct + '%';
        setStep(ev.step, 'running', `${mb(ev.bytes)} מתוך כ־${mb(ev.expected)}`);
      } else if (ev.bytes > 0) {
        setStep(ev.step, 'running', `${mb(ev.bytes)} עד עכשיו`);
      }
      break;
    }
    case 'done':
      setBusy(false);
      for (let k = 0; k < STEPS.length; k++) setStep(k, 'done', '');
      $('#suBarWrap').classList.add('hidden');
      $('#suLine').textContent = '';
      $('#suDevice').textContent = deviceText(ev.result);
      $('#suDone').classList.toggle('warn', !(ev.result && ev.result.device === 'cuda'));
      $('#suDone').classList.remove('hidden');
      $('#suStart').classList.add('hidden');
      $('#suOpen').classList.remove('hidden');
      $('#suOpen').focus();
      break;
    case 'error':
      setBusy(false);
      if (current >= 0) setStep(current, 'failed');
      $('#suBarWrap').classList.add('hidden');
      { // first line is for people, the rest is the tool's own output
        const [msg, ...detail] = String(ev.error || '').split('\n');
        $('#suErrorMsg').textContent = msg;
        $('#suErrorDetail').textContent = detail.join('\n');
        $('#suErrorDetail').classList.toggle('hidden', !detail.join('').trim());
      }
      $('#suError').classList.remove('hidden');
      $('#suStart').textContent = 'נסה שוב';
      $('#suStart').classList.remove('hidden');
      addLog('FAILED: ' + (ev.error || ''));
      break;
  }
}

async function start() {
  setBusy(true);
  $('#suSteps li.failed')?.classList.remove('failed');
  try {
    await invoke('start_setup');
  } catch (e) {
    onProgress({ kind: 'error', error: String(e) });
  }
}

async function openApp() {
  $('#suOpen').disabled = true;
  try {
    await invoke('finish_setup');
    location.replace('index.html');
  } catch (e) {
    $('#suOpen').disabled = false;
    onProgress({ kind: 'error', error: String(e) });
  }
}

async function toggleLog() {
  const pre = $('#suLog');
  const show = pre.classList.contains('hidden');
  pre.classList.toggle('hidden', !show);
  $('#suLogBtn').textContent = show ? 'הסתר פרטים' : 'הצג פרטים';
  if (!show) return;
  if (!logLines.length) {
    try { logLines.push(...(await invoke('setup_log', { lines: 300 })).split('\n')); } catch (_) { /* no log yet */ }
  }
  pre.textContent = logLines.join('\n') || 'עוד אין פרטים.';
  pre.scrollTop = pre.scrollHeight;
}

(async function init() {
  if (!TAURI) { location.replace('index.html'); return; }
  const info = await invoke('setup_info');
  if (!info.needed && !info.running) { location.replace('index.html'); return; }
  STEPS = info.steps;
  renderSteps();
  $('#suPath').textContent = info.runtime || '';
  if (info.free_bytes != null) {
    $('#suFree').textContent = gb(info.free_bytes);
    if (info.free_bytes < info.need_bytes) {
      $('#suSpace').textContent = `אין מספיק מקום. צריך בערך ${gb(info.need_bytes)} פנויים בכונן הזה. אפשר לפנות מקום ואז לסגור ולפתוח את התוכנה שוב.`;
      $('#suSpace').classList.remove('hidden');
      $('#suStart').disabled = true;
    }
  } else {
    $('#suFree').textContent = 'לא ידוע';
  }
  await TAURI.event.listen('setup-progress', (e) => onProgress(e.payload));
  $('#suStart').addEventListener('click', start);
  $('#suOpen').addEventListener('click', openApp);
  $('#suLogBtn').addEventListener('click', toggleLog);
  if (info.running) setBusy(true); // the page was reloaded while setup runs; events keep coming
})();
