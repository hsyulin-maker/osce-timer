import { ExamTimer } from './timer.mjs';
import { latestAlert } from './alerts.mjs';

const $ = id => document.getElementById(id);
const timer = new ExamTimer('examiner');
const KEY = 'osce-examiner-v2';
let audioContext, wakeLock, toastTimeout, savedAt = 0, lastShown = '', lastAnnounced = '', previous;
const options = { sound: true, voice: false, awake: true };
const safeStore = { read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }, write(value) { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Private browsing may disable storage. */ } } };
const saved = safeStore.read();
const identity = { stationNumber: 3, stationName: '腹部身體檢查', studentName: '學員 A' };
if (saved?.identity) {
  if (Number.isInteger(saved.identity.stationNumber) && saved.identity.stationNumber >= 1 && saved.identity.stationNumber <= 999) identity.stationNumber = saved.identity.stationNumber;
  for (const key of ['stationName','studentName']) if (typeof saved.identity[key] === 'string') identity[key] = saved.identity[key].slice(0,40);
}
$('station-number').value = identity.stationNumber;
$('station-name').value = identity.stationName;
$('student-name').value = identity.studentName;
if (saved?.timer) timer.restore(saved.timer);
for (const key of Object.keys(options)) {
  if (typeof saved?.options?.[key] === 'boolean') options[key] = saved.options[key];
  $(key).checked = options[key];
}


function format(ms) {
  const secs = Math.ceil(Math.max(0, ms) / 1000);
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}
function persist() { safeStore.write({ timer: timer.serialize(), options, identity }); }
function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => $('toast').classList.remove('visible'), 3800);
}
function announce(text) { $('announcement').textContent = text; }
async function unlockAudio() {
  if (!options.sound) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    audioContext ||= new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch { toast('此瀏覽器無法播放提示音，請留意畫面提醒。'); }
}
function beep(kind = 'notice') {
  if (!options.sound || !audioContext || audioContext.state !== 'running') return;
  const count = kind === 'end' ? 3 : 2;
  const now = audioContext.currentTime;
  for (let i = 0; i < count; i++) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const at = now + i * .38;
    osc.type = 'sine';
    osc.frequency.value = kind === 'end' ? 660 : 880;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(.3, at + .02);
    gain.gain.exponentialRampToValueAtTime(.001, at + .27);
    osc.connect(gain); gain.connect(audioContext.destination);
    osc.start(at); osc.stop(at + .29);
  }
}
function say(text) {
  if (!options.voice || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'zh-TW'; utterance.rate = .92;
  const voices = speechSynthesis.getVoices();
  const voice = voices.find(v => v.lang === 'zh-TW') || voices.find(v => /^zh/.test(v.lang));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
function alertUser(text, kind = 'notice') {
  beep(kind); say(text); announce(text); toast(text);
  if (typeof navigator.vibrate === 'function') navigator.vibrate(kind === 'end' ? [200, 100, 200, 100, 400] : [160, 80, 160]);
}
async function releaseWake() {
  const lock = wakeLock; wakeLock = null;
  if (lock) try { await lock.release(); } catch { /* Released by browser. */ }
}
async function requestWake() {
  if (!options.awake || timer.status !== 'running' || document.hidden || !('wakeLock' in navigator) || wakeLock) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!options.awake || timer.status !== 'running' || document.hidden) { await lock.release(); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    $('wake-description').textContent = '計時中已保持螢幕常亮';
  } catch { $('wake-description').textContent = '系統未允許常亮，請保持頁面開啟'; }
}
if (!('wakeLock' in navigator)) {
  options.awake = false; $('awake').checked = false; $('awake').disabled = true;
  $('wake-description').textContent = '此瀏覽器不支援，請調整自動鎖定設定';
}
if (!('speechSynthesis' in window)) {
  options.voice = false; $('voice').checked = false; $('voice').disabled = true;
  $('voice').closest('label').querySelector('small').textContent = '此瀏覽器不支援語音播報';
}


function buildTimeline() {
  $('timeline').replaceChildren(...timer.flow.phases.slice(1).map((phase, i) => {
    const item = document.createElement('div'); item.className = 'timeline-step';
    const number = document.createElement('span'); number.className = 'step-number'; number.textContent = String(i + 1).padStart(2, '0');
    const copy = document.createElement('div'); copy.className = 'step-copy';
    const label = document.createElement('b'); label.textContent = phase.label;
    const note = document.createElement('small'); note.textContent = ['獨立 8 分鐘倒數；剩 1 分鐘時提醒', '作答結束後，接續 2 分鐘回饋'][i];
    const duration = document.createElement('span'); duration.className = 'step-time'; duration.textContent = format(phase.durationMs);
    copy.append(label, note); item.append(number, copy, duration); return item;
  }));
}
function render(now = Date.now(), allowAlerts = true) {
  const s = timer.snapshot(now);
  const active = s.status === 'running' || s.status === 'paused';
  const warning = active && s.phaseId === 'exam' && s.phaseRemainingMs <= 60000;
  const shown = format(s.phaseRemainingMs);
  if (shown !== lastShown) {
    $('time').textContent = shown;
    $('time').setAttribute('aria-label', `${s.phaseLabel}剩餘 ${shown}`);
    lastShown = shown;
  }
  $('status-text').textContent = s.status === 'running' && s.phaseId === 'feedback' ? '作答時間到' : {idle:'準備就緒',running:'計時中',paused:'已暫停'}[s.status];
  $('status').className = `status-pill ${s.status}`;
  const card = document.querySelector('.timer-card');
  card.classList.toggle('warning', warning);
  card.dataset.phase = s.phaseId;
  $('phase-label').textContent = s.phaseId === 'reading' && s.stationNumber === 1 ? '讀題時間' : s.phaseLabel;
  $('timer-caption').textContent = `第 ${identity.stationNumber} 站・第 ${s.stationNumber} 輪`;
  $('station-topic').textContent = identity.stationName || '未設定考站名稱';
  $('student-caption').textContent = identity.studentName || '未設定學員';
  $('dial-progress').style.strokeDashoffset = String(100 * (1 - s.phaseRemainingMs / s.phaseDurationMs));
  $('dial-message').textContent = s.status === 'idle' ? '按下開始，先讀題 1 分鐘' : s.status === 'paused' ? '已暫停所有階段計時' : s.phaseId === 'exam' ? (warning ? '最後 1 分鐘' : '作答第 7 分鐘將提醒') : s.phaseId === 'feedback' ? '接著：換站＋讀下一題 1 分鐘' : '接著：作答 8 分鐘';
  $('timer-notice').textContent = s.status === 'paused' ? '按「繼續計時」恢復考場流程。' : warning ? '作答已經過 7 分鐘，剩下 1 分鐘。' : s.phaseId === 'feedback' ? '作答時間到！請停止作答，開始回饋。' : s.phaseId === 'reading' ? (s.stationNumber === 1 ? '請考生閱讀題目，準備開始作答。' : '請換站並閱讀下一題，共 1 分鐘。') : '作答時間到，將自動進入 2 分鐘回饋。';
  $('start-label').textContent = s.status === 'running' ? '暫停計時' : s.status === 'paused' ? '繼續計時' : '開始本站讀題';
  $('start-icon').setAttribute('href', s.status === 'running' ? '#i-pause' : '#i-play');
  $('reset').disabled = s.status === 'idle';
  $('elapsed').textContent = format(Math.floor(s.examElapsedMs / 1000) * 1000);
  $('total-line').replaceChildren(document.createTextNode('考試剩餘 '), Object.assign(document.createElement('strong'), {textContent:format(s.examRemainingMs)}));
  $('reading-separate').classList.toggle('active', s.phaseId === 'reading');
  [...$('timeline').children].forEach((node,i) => {
    node.classList.toggle('active', i + 1 === s.phaseIndex);
    node.classList.toggle('complete', i + 1 < s.phaseIndex);
  });
  document.title = active ? `${shown} · 第${identity.stationNumber}站 ${s.phaseLabel}` : 'OSCE 考官計時器';
  const stateKey = `${s.status}-${s.stationNumber}-${s.phaseIndex}`;
  if (lastAnnounced !== stateKey) { if(s.status === 'paused') announce('計時已暫停。'); lastAnnounced = stateKey; }
  if (allowAlerts && previous && (previous.status === 'running' || s.status === 'running')) {
    const cue = latestAlert(previous.absoluteElapsedMs, s.absoluteElapsedMs);
    if (cue) alertUser(cue.text, cue.kind);
  }
  previous = s;
  if (s.status === 'running' && now - savedAt > 1000) { savedAt = now; persist(); }
  return s;
}
async function toggleTimer() {
  if (timer.status === 'running') {
    timer.pause(); render(); persist(); await releaseWake();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    $('wake-description').textContent = '計時時盡量避免螢幕休眠';
    return;
  }
  const beginning = timer.status === 'idle';
  timer.start(); render(); persist();
  await unlockAudio();
  if (timer.status === 'running') {
    if (beginning) { beep(); say(`第 ${identity.stationNumber} 站，請閱讀題目，時間 1 分鐘。`); announce('開始讀題，時間 1 分鐘。'); }
    requestWake();
  }
}
$('start').addEventListener('click', toggleTimer);
$('reset').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-dialog').addEventListener('close', () => { if ($('reset-dialog').returnValue === 'reset') reset(); });
function reset() {
  timer.reset(); previous = null; lastShown = ''; releaseWake();
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  buildTimeline(); render(); persist(); announce('已重設為第 1 輪讀題。');
  $('wake-description').textContent = 'wakeLock' in navigator ? '計時時盡量避免螢幕休眠' : '此瀏覽器不支援，請調整自動鎖定設定';
}
for (const key of Object.keys(options)) $(key).addEventListener('change', async () => {
  options[key] = $(key).checked; persist();
  if (key === 'awake') options.awake ? requestWake() : releaseWake();
  if (key === 'sound' && options.sound) await unlockAudio();
  if (key === 'voice' && !options.voice && 'speechSynthesis' in window) speechSynthesis.cancel();
});
for (const [id,key] of [['station-number','stationNumber'],['station-name','stationName'],['student-name','studentName']]) {
  $(id).addEventListener('change', () => {
    if (key === 'stationNumber') {
      const n = Number($(id).value);
      identity[key] = Number.isInteger(n) && n >= 1 && n <= 999 ? n : identity[key];
      $(id).value = identity[key];
    } else identity[key] = $(id).value.trim().slice(0,40);
    render(); persist();
  });
}
$('test-sound').addEventListener('click', async () => {
  if (!options.sound && !options.voice) { toast('請先開啟提示音或語音提醒。'); return; }
  await unlockAudio(); beep(); say('作答已經過 7 分鐘，剩下 1 分鐘。');
  toast(options.sound ? '提示音測試中，請確認裝置音量。' : '語音提醒測試中。');
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.querySelector('.page-shell').requestFullscreen) await document.querySelector('.page-shell').requestFullscreen();
    else toast('此瀏覽器不支援全螢幕，可將網頁加入主畫面使用。');
  } catch { toast('無法進入全螢幕，請使用瀏覽器的全螢幕選項。'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').querySelector('span').textContent = document.fullscreenElement ? '離開全螢幕' : '全螢幕'; });
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.repeat && !['INPUT','SELECT','BUTTON','TEXTAREA','A','SUMMARY'].includes(document.activeElement?.tagName) && !$('reset-dialog').open) { e.preventDefault(); toggleTimer(); }
});
document.addEventListener('visibilitychange', () => { render(); persist(); if (!document.hidden) requestWake(); });
window.addEventListener('pagehide', persist);
buildTimeline();
render(Date.now(), false);
if (timer.status === 'running') { toast('已恢復計時。請點「測試提醒」啟用此頁面的提示音。'); requestWake(); }
setInterval(render, 100);
