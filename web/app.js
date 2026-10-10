'use strict';
const $ = (id) => document.getElementById(id);
let state = 'idle', selectedFile = null, objectUrl = null;
const USAGE_ACK_KEY = 'shengyu.voice-usage-acknowledged.v1';
let usageAcknowledged = false, durationReminderShown = false;
try { usageAcknowledged = window.localStorage.getItem(USAGE_ACK_KEY) === 'true'; } catch {}
let recorder = null, stream = null, chunks = [], timer = null, startedAt = 0;
let pendingCapture = 0, discardRecording = false, request = null, maxTimer = null;
let levelContext = null, levelSource = null, levelAnalyser = null, levelSamples = null, quietSince = null;
let environmentTimer = null, environmentLevels = [], interruptionMessage = '';
let captureQuality = [], selectedQuality = [], previousDisplay = null;
function rememberQuality(text, attention = true) {
  if (!captureQuality.some(item => item.text === text)) captureQuality.push({ text, attention });
}
function restoreAudio() {
  state = selectedFile ? 'ready' : 'idle';
  if (previousDisplay) {
    $('timer').textContent = previousDisplay.timer;
    $('record-hint').textContent = previousDisplay.hint;
  }
  previousDisplay = null;
}
const MAX_BYTES = 25 * 1024 * 1024;
const SUPPORTED_AUDIO = /\.(wav|webm|ogg|m4a|mp4|mp3|flac)$/i;

function message(text = '', error = false) {
  $('message').textContent = text; $('message').hidden = !text;
  $('message').classList.toggle('error', error);
}
function step(index) {
  [1, 2, 3].forEach(n => { $('step-' + n).classList.toggle('current', n === index); if (n === index) $('step-' + n).setAttribute('aria-current', 'step'); else $('step-' + n).removeAttribute('aria-current'); });
}
function updateControls() {
  const recording = state === 'recording', capturing = state === 'permission' || state === 'calibrating';
  const busy = state === 'analyzing', stopping = state === 'stopping';
  const checkingEnvironment = state === 'calibrating';
  $('timer').classList.toggle('calibrating', checkingEnvironment);
  $('timer').setAttribute('aria-label', checkingEnvironment ? '环境检测倒计时' : '录音时长');
  $('timer').setAttribute('aria-live', checkingEnvironment ? 'polite' : 'off');
  $('record-hint').hidden = checkingEnvironment;
  $('start').hidden = !!selectedFile || recording || stopping;
  $('start').disabled = !usageAcknowledged || capturing || busy || stopping;
  $('choose-audio').hidden = !!selectedFile || recording || capturing || stopping;
  $('choose-audio').disabled = !usageAcknowledged || busy;
  $('audio-choice-separator').hidden = $('choose-audio').hidden;
  $('audio-file').disabled = !usageAcknowledged || recording || capturing || busy || stopping;
  $('stop').hidden = !recording;
  $('cancel').hidden = !(recording || capturing || stopping);
  $('cancel').disabled = stopping;
  $('submit').hidden = !selectedFile;
  $('submit').disabled = !selectedFile || !usageAcknowledged || recording || capturing || busy || stopping;
  $('submit').textContent = busy ? '正在分析，请稍候…' : '提交并分析 →';
  $('reset').disabled = recording || capturing || busy || stopping;
  $('again').disabled = recording || capturing || busy || stopping;
  $('replace-file').disabled = recording || capturing || busy || stopping;
  $('preview').hidden = !selectedFile || recording || capturing || stopping;
  $('record-visual').classList.toggle('recording', recording);
}
function stopLevelMeter() {
  if (levelSource) { try { levelSource.disconnect(); } catch {} }
  if (levelContext && levelContext.state !== 'closed') levelContext.close().catch(() => {});
  levelContext = null; levelSource = null; levelAnalyser = null; levelSamples = null; quietSince = null;
  $('live-quality').hidden = true;
  $('level-meter').value = -60;
  $('record-visual').style.setProperty('--input-level', '.3');
}
function startLevelMeter(input) {
  $('live-quality').hidden = false;
  $('live-quality').classList.toggle('attention', false);
  const AudioEngine = window.AudioContext || window.webkitAudioContext;
  if (!AudioEngine) { $('level-hint').textContent = '当前浏览器无法显示实时音量，请在录音后试听。'; return; }
  try {
    levelContext = new AudioEngine();
    levelAnalyser = levelContext.createAnalyser(); levelAnalyser.fftSize = 2048;
    levelSource = levelContext.createMediaStreamSource(input); levelSource.connect(levelAnalyser);
    // Do not connect to destination: no microphone playback or acoustic feedback.
    levelSamples = new Float32Array(levelAnalyser.fftSize);
    if (levelContext.state === 'suspended') levelContext.resume().catch(() => {});
    $('level-value').textContent = '—'; $('level-hint').textContent = '正在检测声音…';
  } catch {
    stopLevelMeter(); $('live-quality').hidden = false;
    $('level-hint').textContent = '实时音量检测暂不可用；仍可录音，请录完后试听。';
  }
}
function updateLevelMeter(now) {
  if (!levelAnalyser || !levelSamples) return;
  if (levelContext.state !== 'running') { $('level-hint').textContent = '音量检测等待浏览器恢复，录音后请试听确认。'; rememberQuality($('level-hint').textContent); return; }
  try { levelAnalyser.getFloatTimeDomainData(levelSamples); } catch { return; }
  let energy = 0, peak = 0;
  for (const value of levelSamples) { energy += value * value; peak = Math.max(peak, Math.abs(value)); }
  const db = 20 * Math.log10(Math.max(Math.sqrt(energy / levelSamples.length), .000001));
  $('level-meter').value = Math.max(-60, Math.min(0, db));
  $('level-value').textContent = db <= -60 ? '低于 −60 dBFS' : `${Math.round(db)} dBFS`;
  $('record-visual').style.setProperty('--input-level', String(.3 + Math.max(0, Math.min(1, (db + 60) / 60)) * 1.7));
  if (state === 'calibrating') {
    environmentLevels.push(db);
    $('level-hint').textContent = '请暂时不要说话，正在检查录音前的环境声…';
    return;
  }
  if (db < -45) { if (quietSince === null) quietSince = now; } else quietSince = null;
  let hint = '检测到声音，请保持自然音量。', attention = false;
  if (stream?.getAudioTracks?.().some(track => track.muted)) { hint = '麦克风输入暂时中断，请检查设备连接或系统麦克风设置。'; attention = true; }
  else if (peak >= .98) { hint = '音量接近上限，请离麦克风稍远一些。'; attention = true; }
  else if (quietSince !== null && now - quietSince >= 3000) { hint = db < -60 ? '暂未检测到明显声音，请检查麦克风或开口说话。' : '声音持续偏轻，请稍靠近麦克风。'; attention = true; }
  else if (db < -45) hint = '正在等待声音…';
  if ($('level-hint').textContent !== hint) $('level-hint').textContent = hint;
  $('live-quality').classList.toggle('attention', attention);
  if (attention) rememberQuality(hint);
}
function showEnvironmentResult() {
  // Advisory digital-level thresholds, not calibrated room SPL or a speech/noise classifier.
  const values = environmentLevels.slice().sort((a, b) => a - b);
  let text = '环境检查未取得足够数据，录音后请试听确认。', attention = false;
  if (values.length >= 10) {
    const median = values[Math.floor(values.length / 2)];
    const spread = values[Math.floor(values.length * .9)] - values[Math.floor(values.length * .1)];
    if (spread > 15) {
      text = '检查期间声音变化较大，可能有说话或突发声。建议取消后在安静状态下重试。'; attention = true;
    } else if (median > -40) {
      text = '录音前的环境声可能偏大，建议换到更安静的地方后重录。'; attention = true;
    } else if (median < -90) {
      text = '检查期间几乎没有输入信号，请开口说话并观察音量，确认麦克风正常。'; attention = true;
    } else {
      text = '环境声检查完成，现在可以自然说话；录音后请试听确认。';
    }
  }
  $('environment-hint').textContent = text;
  $('environment-hint').hidden = false;
  $('environment-hint').classList.toggle('attention', attention);
  rememberQuality(text, attention || values.length < 10);
  environmentLevels = [];
}
function releaseStream() {
  clearTimeout(environmentTimer); environmentTimer = null;
  stopLevelMeter();
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  clearInterval(timer); timer = null;
  clearTimeout(maxTimer); maxTimer = null;
  $('duration-reminder').hidden = true;
}
function clearFile() {
  $('playback').pause(); $('playback').removeAttribute('src'); $('playback').load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null; selectedFile = null; $('preview').hidden = true;
  selectedQuality = [];
  $('audio-file').value = '';
  $('result').hidden = true;
  $('environment-hint').hidden = true;
}
function selectFile(file, observations = []) {
  if (!file.size) { message('音频为空，请重新录制或选择文件。', true); updateControls(); return; }
  if (file.size > MAX_BYTES) { message('音频不能超过 25 MB。', true); updateControls(); return; }
  if (!SUPPORTED_AUDIO.test(file.name)) { message('请选择 WAV、WebM、OGG、M4A、MP4、MP3 或 FLAC 音频。', true); updateControls(); return; }
  clearFile(); state = 'idle'; step(1);
  selectedFile = file; objectUrl = URL.createObjectURL(file);
  selectedQuality = observations.slice(); previousDisplay = null;
  $('playback').src = objectUrl; $('file-name').textContent = file.name;
  $('file-size').textContent = file.size < 1024 * 1024 ? `${(file.size / 1024).toFixed(1)} KB` : `${(file.size / 1024 / 1024).toFixed(2)} MB`;
  $('preview').hidden = false; state = 'ready'; step(1);
  message('声音已准备好。请试听后提交分析。'); updateControls();
}
function reset() {
  pendingCapture++; discardRecording = true;
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  releaseStream(); recorder = null; chunks = []; clearFile();
  captureQuality = []; previousDisplay = null;
  state = 'idle'; $('timer').textContent = '00:00';
  $('record-hint').textContent = '准备好了，就按下开始'; message(); step(1); updateControls();
}
function finish(discard = false) {
  if (state === 'stopping') return;
  discardRecording = discard;
  pendingCapture++;
  if (recorder && recorder.state !== 'inactive') {
    state = 'stopping'; recorder.stop();
  } else { restoreAudio(); }
  releaseStream();
  if (discard) { $('environment-hint').hidden = true; message(selectedFile ? '已取消新录音，原音频仍保留。' : '录音已取消，没有提交。'); if (!selectedFile) $('record-hint').textContent = '可以重新开始录音'; }
  updateControls();
}
async function startRecording() {
  if (!usageAcknowledged || ['recording', 'permission', 'calibrating', 'analyzing', 'stopping'].includes(state)) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    message('当前环境无法录音。请使用支持录音的浏览器，通过 HTTPS 或本机 localhost 访问。', true); return;
  }
  previousDisplay = { timer: $('timer').textContent, hint: $('record-hint').textContent };
  $('playback').pause(); $('environment-hint').hidden = true;
  captureQuality = []; message(); durationReminderShown = false; $('duration-reminder').hidden = true;
  environmentLevels = []; interruptionMessage = '';
  state = 'permission'; updateControls();
  const capture = ++pendingCapture;
  $('record-hint').textContent = '请在浏览器中允许麦克风访问';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    if (capture !== pendingCapture) { newStream.getTracks().forEach(t => t.stop()); return; }
    stream = newStream; chunks = []; discardRecording = false;
    stream.getTracks().forEach(track => track.addEventListener?.('ended', () => {
      if (capture !== pendingCapture) return;
      interruptionMessage = '麦克风已断开或访问已结束，请检查设备后重试。';
      rememberQuality(interruptionMessage);
      if (state === 'calibrating') { finish(true); message(interruptionMessage, true); }
      else if (state === 'recording') finish();
    }));
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported(t));
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const activeRecorder = recorder;
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onerror = () => { finish(true); message('录音中断，请检查麦克风后重试。', true); };
    recorder.onstop = () => {
      releaseStream();
      const recordedDuration = $('timer').textContent;
      restoreAudio();
      if (!discardRecording) {
        const type = activeRecorder.mimeType || chunks[0]?.type || 'audio/webm';
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm';
        const recordedFile = new File(chunks, `recording.${extension}`, { type });
        selectFile(recordedFile, captureQuality);
        if (selectedFile === recordedFile) { $('record-hint').textContent = '录音完成，试听一下吧'; $('timer').textContent = recordedDuration; }
        if (interruptionMessage) message(interruptionMessage + ' 已保留录到的片段，请先试听。', true);
      }
      chunks = []; recorder = null; updateControls();
    };
    startLevelMeter(stream);
    const beginRecording = () => {
      if (capture !== pendingCapture) return;
      clearInterval(timer); timer = null;
      clearTimeout(environmentTimer); environmentTimer = null;
      try { recorder.start(250); } catch {
        releaseStream(); recorder = null; restoreAudio();
        message('无法开始录音，请检查麦克风后重试。', true); updateControls(); return;
      }
      startedAt = performance.now(); state = 'recording'; quietSince = null;
      maxTimer = setTimeout(() => finish(), 180000);
      $('record-hint').textContent = '正在录音，请自然说话'; $('timer').textContent = '00:00'; step(1);
      timer = setInterval(() => {
        updateLevelMeter(performance.now());
        const seconds = Math.min(180, Math.floor((performance.now() - startedAt) / 1000));
        $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        if (seconds >= 120 && !durationReminderShown) {
          durationReminderShown = true;
          $('duration-reminder').hidden = false;
        }
        if (performance.now() - startedAt >= 180000) finish();
      }, 200);
      updateControls();
    };
    if (levelAnalyser) {
      state = 'calibrating'; const checkStartedAt = performance.now();
      $('timer').textContent = '请保持安静，3 秒后开始录音';
      timer = setInterval(() => {
        updateLevelMeter(performance.now());
        const remaining = Math.max(1, Math.ceil((3000 - (performance.now() - checkStartedAt)) / 1000));
        const countdown = `请保持安静，${remaining} 秒后开始录音`;
        if ($('timer').textContent !== countdown) $('timer').textContent = countdown;
      }, 100);
      environmentTimer = setTimeout(() => {
        if (capture !== pendingCapture) return;
        showEnvironmentResult(); beginRecording();
      }, 3000);
      updateControls();
    } else {
      $('environment-hint').hidden = false;
      $('environment-hint').textContent = '当前浏览器无法检查环境声，录音后请试听确认。';
      $('environment-hint').classList.toggle('attention', false);
      rememberQuality($('environment-hint').textContent);
      beginRecording();
    }
  } catch (error) {
    if (capture !== pendingCapture) return;
    releaseStream(); restoreAudio();
    const messages = { NotAllowedError: '麦克风权限被拒绝。请在浏览器设置中允许访问后重试。', NotFoundError: '没有找到麦克风，请连接设备后重试。', NotReadableError: '麦克风可能被其他程序占用，请关闭占用程序后重试。' };
    message(messages[error.name] || '无法开始录音，请检查麦克风后重试。', true);
    if (!selectedFile) $('record-hint').textContent = '录音尚未开始'; updateControls();
  }
}
function showResult(data) {
  if (!Number.isFinite(data.score) || data.score < 0 || data.score > 1 || !data.model_version || !Number.isFinite(data.audio_duration_seconds) || !Number.isFinite(data.analysis_seconds)) throw new Error('服务返回的数据不完整，请联系项目维护者。');
  $('score').textContent = data.score.toFixed(4);
  LiquidGauge.render($('score-gauge'), data.score);
  $('result-duration').textContent = `${data.audio_duration_seconds.toFixed(1)} 秒`;
  $('result-time').textContent = `${data.analysis_seconds.toFixed(2)} 秒`;
  $('result-version').textContent = data.model_version;
  const quality = data.audio_quality;
  $('quality-result').hidden = !quality && !selectedQuality.length;
  $('quality-issues').replaceChildren();
  const issues = Array.isArray(quality?.issues) ? quality.issues : [];
  const attention = selectedQuality.some(item => item.attention) || issues.length > 0;
  $('quality-result').classList.toggle('attention', attention);
  $('quality-result').style.setProperty('order', attention ? '1' : '3');
  $('quality-summary').textContent = attention ? '本次音频有以下提示，建议先试听，必要时重新录制。' : quality?.summary || '录音前的环境检查已完成，请以试听为准。';
  $('quality-disclaimer').textContent = selectedQuality.length ? '包含录音前的环境声检查、录音过程提示和提交后的音量检查；仅供录音操作参考。' : quality?.disclaimer || '质量提示仅供录音操作参考。';
  const observations = [...selectedQuality.map(item => item.text), ...issues.map(issue => issue.message)].filter(Boolean);
  [...new Set(observations)].forEach(text => { const li = document.createElement('li'); li.textContent = text; $('quality-issues').append(li); });
  $('result').hidden = false; message('分析完成。结果仅保留在当前页面。'); step(3);
  $('result').focus({ preventScroll: true }); $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function submit() {
  if (!selectedFile || !usageAcknowledged || state !== 'ready') return;
  $('playback').pause(); $('result').hidden = true; message(); state = 'analyzing'; step(2); updateControls();
  $('progress-wrap').hidden = false; $('progress').value = 0; $('progress-label').textContent = '正在上传音频…';
  const xhr = new XMLHttpRequest(); request = xhr;
  xhr.open('POST', '/api/voice/analyze'); xhr.timeout = 180000;
  xhr.upload.onprogress = event => { if (event.lengthComputable) $('progress').value = event.loaded / event.total * 100; };
  xhr.upload.onload = () => { $('progress-label').textContent = '上传完成，模型正在分析…'; $('progress').removeAttribute('value'); };
  const done = () => { state = 'ready'; request = null; $('progress-wrap').hidden = true; updateControls(); };
  const fail = text => { done(); step(1); message(text, true); };
  xhr.onload = () => {
    try {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error?.message || '分析服务返回错误，请重试。');
      showResult(data); done();
    } catch (error) { $('result').hidden = true; fail(error instanceof SyntaxError ? '服务返回格式异常，请重试。' : error.message); }
  };
  xhr.onerror = () => fail('无法连接分析服务。音频仍可试听，请检查网络后重试。');
  xhr.ontimeout = () => fail('分析等待超时。服务可能仍在完成本次计算，请稍后重试。');
  xhr.onabort = () => fail('已取消等待。已上传的音频可能仍会在服务端完成处理并清理。');
  const body = new FormData(); body.append('audio', selectedFile); body.append('consent', 'true'); xhr.send(body);
}
async function checkHealth() {
  $('health-button').className = 'health'; $('health-text').textContent = '正在检查服务';
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) throw new Error();
    const data = await response.json(), ready = data.status === 'ready';
    $('health-button').classList.add(ready ? 'ready' : 'unavailable');
    $('health-text').textContent = ready ? '研究模型已就绪' : '服务尚未就绪';
    $('service-notice').hidden = ready; $('service-notice').textContent = data.message;
  } catch {
    $('health-button').classList.add('unavailable'); $('health-text').textContent = '服务连接失败';
    $('service-notice').hidden = false; $('service-notice').textContent = '暂时无法连接分析服务。可以准备音频，服务恢复后再提交。点击右上角状态可重新检查。';
  }
}
$('start').addEventListener('click', startRecording);
$('choose-audio').addEventListener('click', () => {
  if (!usageAcknowledged || !['idle', 'ready'].includes(state)) return;
  $('audio-file').value = '';
  $('audio-file').click();
});
$('audio-file').addEventListener('change', event => {
  if (!usageAcknowledged || !['idle', 'ready'].includes(state)) return;
  const file = event.target.files?.[0];
  if (!file) return;
  selectFile(file);
  if (selectedFile === file) {
    $('timer').textContent = '00:00';
    $('record-hint').textContent = '已选择音频，试听后即可提交';
  }
});
$('stop').addEventListener('click', () => finish());
$('cancel').addEventListener('click', () => finish(true));
$('reset').addEventListener('click', () => { if (state === 'ready') return startRecording(); });
$('replace-file').addEventListener('click', () => {
  if (state !== 'ready' || !usageAcknowledged) return;
  $('audio-file').value = ''; $('audio-file').click();
});
$('again').addEventListener('click', () => { reset(); $('recorder-title').scrollIntoView({ behavior: 'smooth' }); });
$('submit').addEventListener('click', submit);
$('usage-dialog').addEventListener('cancel', event => event.preventDefault());
$('acknowledge-usage').addEventListener('click', () => {
  usageAcknowledged = true;
  try { window.localStorage.setItem(USAGE_ACK_KEY, 'true'); } catch {}
  $('usage-dialog').close(); updateControls(); $('start').focus();
});
$('cancel-request').addEventListener('click', () => request?.abort());
$('health-button').addEventListener('click', checkHealth);
$('playback').addEventListener('loadedmetadata', () => {
  if (!selectedFile || !objectUrl) return;
  const seconds = $('playback').duration;
  if (Number.isFinite(seconds) && (seconds < 2 || seconds > 180.5)) message('音频时长可能不符合 2 秒至 3 分钟的限制，请重新录制或选择。', true);
});
$('playback').addEventListener('error', () => {
  if (selectedFile) message('浏览器无法试听本次录音，可尝试提交分析，或重新录制。', true);
});
if (window.matchMedia?.('(max-width: 680px)').matches) $('recording-guide').open = false;
window.addEventListener('pagehide', () => { pendingCapture++; discardRecording = true; if (recorder?.state === 'recording') recorder.stop(); releaseStream(); request?.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); });
updateControls(); checkHealth();
if (!usageAcknowledged) $('usage-dialog').showModal();
