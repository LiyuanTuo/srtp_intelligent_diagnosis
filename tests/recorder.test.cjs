// Exercise the actual browser controller with deterministic media/network adapters.
// These are unit tests, not claims of physical-device recording compatibility.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { File } = require('node:buffer');

function setup(getMedia, { acknowledge = true, storage = new Map() } = {}) {
  const elements = new Map(), windowEvents = {}, timeouts = new Map(), intervals = new Map();
  let now = 0;
  let nextTimer = 0, stopped = 0, created = 0, revoked = 0;
  class Element {
    constructor() { this.hidden = false; this.disabled = false; this.checked = false; this.value = ''; this.events = {}; this.children = []; this.properties = {}; this.attributes = {}; this.classes = new Set(); this.style = { setProperty: (key, value) => this.properties[key] = value }; this.classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key), add: key => this.classes.add(key) }; }
    querySelector(selector) { this.nodes ||= {}; return this.nodes[selector] ||= new Element(); }
    getClientRects() { return []; }
    addEventListener(name, handler) { this.events[name] = handler; }
    setAttribute(key, value) { this.attributes[key] = value; } removeAttribute() {} pause() {} load() {} focus() {} scrollIntoView() {}
    showModal() { this.open = true; } close() { this.open = false; }
    click() { this.clicked = true; }
    replaceChildren() { this.children = []; } append(child) { this.children.push(child); }
    fire(event, payload = {}) { return this.events[event]?.(payload); }
  }
  const html = fs.readFileSync('web/index.html', 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
  const element = id => {
    assert.ok(ids.has(id), `Missing element in page: ${id}`);
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const track = { events: {}, muted: false, stop() { stopped++; }, addEventListener(name, handler) { this.events[name] = handler; } };
  const stream = { getTracks() { return [track]; }, getAudioTracks() { return [track]; } };
  class Recorder {
    static last;
    static isTypeSupported(type) { return type.includes('webm'); }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm;codecs=opus'; Recorder.last = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['test bytes'], { type: this.mimeType }) }); this.onstop?.(); }); }
  }
  class XHR {
    static last;
    constructor() { this.upload = {}; XHR.last = this; }
    open() {} send(body) { this.body = body; } abort() { this.onabort?.(); }
  }
  const window = { isSecureContext: true, MediaRecorder: Recorder, addEventListener(name, fn) { windowEvents[name] = fn; } };
  window.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const context = vm.createContext({
    document: { getElementById: element, createElement: () => new Element(), createElementNS: () => new Element() }, window,
    navigator: { mediaDevices: { getUserMedia: getMedia || (async () => stream) } },
    MediaRecorder: Recorder, XMLHttpRequest: XHR, File, Blob, FormData, AbortSignal,
    URL: { createObjectURL() { created++; return 'blob:test'; }, revokeObjectURL() { revoked++; } },
    performance: { now: () => now }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setInterval: fn => { const id = ++nextTimer; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout: fn => { const id = ++nextTimer; timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({ status: 'ready' }) }),
  });
  vm.runInContext(fs.readFileSync('web/liquid-gauge.js', 'utf8'), context);
  context.LiquidGauge = window.LiquidGauge;
  vm.runInContext(fs.readFileSync('web/app.js', 'utf8'), context);
  if (acknowledge) element('acknowledge-usage').fire('click');
  return { element, Recorder, XHR, stream, track, windowEvents, timeouts, window, intervals, setNow: value => { now = value; }, stats: () => ({ stopped, created, revoked }) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

function attachMeter(h, readAmplitude, status = 'running') {
  h.window.AudioContext = class {
    state = status;
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(readAmplitude()); } }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  };
}

function completeEnvironmentCheck(h) {
  const tick = [...h.intervals.values()][0];
  for (let time = 100; time < 3000; time += 100) { h.setNow(time); tick(); }
  h.setNow(3000); [...h.timeouts.values()][0]();
}

test('environment check warns on loud background and starts recorder only afterwards', async () => {
  const h = setup(); attachMeter(h, () => .04);
  await h.element('start').fire('click');
  assert.equal(h.Recorder.last.state, 'inactive');
  assert.equal(h.element('choose-audio').hidden, true);
  assert.equal(h.element('audio-choice-separator').hidden, true);
  assert.equal(h.element('cancel').hidden, false);
  assert.equal(h.element('timer').textContent, '请保持安静，3 秒后开始录音');
  assert.equal(h.element('timer').classes.has('calibrating'), true);
  assert.equal(h.element('timer').attributes['aria-label'], '环境检测倒计时');
  assert.equal(h.element('record-hint').hidden, true);
  h.setNow(1000); [...h.intervals.values()][0]();
  assert.equal(h.element('timer').textContent, '请保持安静，2 秒后开始录音');
  completeEnvironmentCheck(h);
  assert.match(h.element('environment-hint').textContent, /环境声可能偏大/);
  assert.equal(h.Recorder.last.state, 'recording');
  assert.equal(h.element('timer').textContent, '00:00');
  assert.equal(h.element('timer').classes.has('calibrating'), false);
  assert.equal(h.element('timer').attributes['aria-label'], '录音时长');
  assert.equal(h.element('record-hint').hidden, false);
  h.setNow(123000); [...h.intervals.values()][0]();
  assert.equal(h.element('timer').textContent, '02:00');
  assert.equal(h.element('duration-reminder').hidden, false);
  h.element('cancel').fire('click'); await settle();
  assert.equal(h.element('audio-choice-separator').hidden, false);
});

test('cancel or page exit during environment check releases devices without a recording', async () => {
  for (const action of ['cancel', 'pagehide']) {
    const h = setup(); attachMeter(h, () => .001);
    await h.element('start').fire('click');
    const staleCallback = [...h.timeouts.values()][0];
    if (action === 'cancel') h.element('cancel').fire('click'); else h.windowEvents.pagehide();
    staleCallback();
    assert.equal(h.Recorder.last.state, 'inactive');
    assert.equal(h.stats().stopped, 1);
    assert.equal(h.stats().created, 0);
    assert.equal(h.timeouts.size, 0);
    assert.equal(h.intervals.size, 0);
  }
});

test('variable sound and unavailable meter do not get classified as a quiet environment', async () => {
  let frames = 0;
  const varied = setup(); attachMeter(varied, () => (++frames % 2 ? .001 : .1));
  await varied.element('start').fire('click'); completeEnvironmentCheck(varied);
  assert.match(varied.element('environment-hint').textContent, /声音变化较大/);
  const suspended = setup(); attachMeter(suspended, () => .001, 'suspended');
  await suspended.element('start').fire('click'); completeEnvironmentCheck(suspended);
  assert.match(suspended.element('environment-hint').textContent, /未取得足够数据/);
  assert.equal(suspended.Recorder.last.state, 'recording');
  const silent = setup(); attachMeter(silent, () => 0);
  await silent.element('start').fire('click'); completeEnvironmentCheck(silent);
  assert.match(silent.element('environment-hint').textContent, /几乎没有输入信号/);
});

test('quiet baseline does not report normal speech as noise; mute and disconnect are reported', async () => {
  let amplitude = .001;
  const h = setup(); attachMeter(h, () => amplitude);
  await h.element('start').fire('click'); completeEnvironmentCheck(h);
  assert.match(h.element('environment-hint').textContent, /检查完成/);
  amplitude = .1; [...h.intervals.values()][0]();
  assert.match(h.element('level-hint').textContent, /保持自然音量/);
  h.track.muted = true; [...h.intervals.values()][0]();
  assert.match(h.element('level-hint').textContent, /输入暂时中断/);
  h.track.events.ended(); await settle();
  assert.equal(h.Recorder.last.state, 'inactive');
  assert.equal(h.element('preview').hidden, false);
  assert.match(h.element('message').textContent, /麦克风已断开/);
  assert.equal(h.stats().stopped, 1);
});

test('usage acknowledgement persists across visits and is separate for a new browser', () => {
  const storage = new Map();
  const first = setup(undefined, { acknowledge: false, storage });
  assert.equal(first.element('usage-dialog').open, true);
  assert.equal(first.element('start').disabled, true);
  let prevented = false;
  first.element('usage-dialog').fire('cancel', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  first.element('acknowledge-usage').fire('click');
  assert.equal(first.element('usage-dialog').open, false);
  assert.equal(first.element('start').disabled, false);
  const returning = setup(undefined, { acknowledge: false, storage });
  assert.notEqual(returning.element('usage-dialog').open, true);
  assert.equal(returning.element('start').disabled, false);
  assert.equal(setup(undefined, { acknowledge: false }).element('usage-dialog').open, true);
});

test('blocked browser storage still permits recording after acknowledgement', () => {
  const storage = { get() { throw new Error('blocked'); }, set() { throw new Error('blocked'); } };
  const h = setup(undefined, { acknowledge: false, storage });
  assert.equal(h.element('usage-dialog').open, true);
  h.element('acknowledge-usage').fire('click');
  assert.equal(h.element('start').disabled, false);
  assert.equal(h.element('usage-dialog').open, false);
});

test('two-minute reminder does not stop capture and resets between recordings', async () => {
  const h = setup();
  await h.element('start').fire('click');
  const tick = [...h.intervals.values()][0];
  h.setNow(119999); tick();
  assert.equal(h.element('duration-reminder').hidden, true);
  h.setNow(120000); tick();
  assert.equal(h.element('duration-reminder').hidden, false);
  assert.equal(h.element('timer').textContent, '02:00');
  assert.equal(h.Recorder.last.state, 'recording');
  h.element('cancel').fire('click'); await settle();
  assert.equal(h.element('duration-reminder').hidden, true);
  await h.element('start').fire('click');
  assert.equal(h.element('duration-reminder').hidden, true);
  h.setNow(240000); [...h.intervals.values()][0]();
  assert.equal(h.element('duration-reminder').hidden, false);
  h.setNow(300000); [...h.intervals.values()][0](); await settle();
  assert.equal(h.Recorder.last.state, 'inactive');
  assert.equal(h.element('duration-reminder').hidden, true);
});

test('record, stop, preview, re-record releases microphone and object URL', async () => {
  const h = setup();
  assert.equal(h.element('submit').hidden, true);
  await h.element('start').fire('click');
  assert.equal(h.element('choose-audio').hidden, true);
  assert.equal(h.element('stop').hidden, false);
  assert.equal(h.element('submit').disabled, true);
  h.element('stop').fire('click'); await settle();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('file-name').textContent, 'recording.webm');
  assert.equal(h.element('submit').disabled, false);
  assert.equal(h.element('submit').hidden, false);
  h.element('replace-file').fire('click');
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('submit').hidden, false);
  assert.equal(h.element('choose-audio').hidden, true);
  assert.equal(h.stats().revoked, 0);
  await h.element('start').fire('click');
  h.element('cancel').fire('click'); await settle();
  assert.equal(h.element('submit').disabled, false);
  assert.equal(h.stats().created, 1);
  assert.equal(h.stats().revoked, 0);
});

test('choose existing audio reveals analysis without sending it; replacement picker keeps preview', () => {
  const h = setup();
  assert.equal(h.element('choose-audio').hidden, false);
  assert.equal(h.element('submit').hidden, true);
  h.element('choose-audio').fire('click');
  assert.equal(h.element('audio-file').clicked, true);
  h.element('audio-file').fire('change', { target: { files: [] } });
  assert.equal(h.element('submit').hidden, true);
  const file = new File(['test audio'], 'sample.WAV', { type: 'audio/wav' });
  h.element('audio-file').fire('change', { target: { files: [file] } });
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('submit').hidden, false);
  assert.equal(h.element('submit').disabled, false);
  assert.equal(h.element('start').hidden, true);
  assert.equal(h.XHR.last, undefined);
  h.element('submit').fire('click');
  assert.equal(h.XHR.last.body.get('audio').name, 'sample.WAV');
  assert.equal(h.XHR.last.body.get('consent'), 'true');
  h.XHR.last.onerror();
  assert.equal(h.element('submit').hidden, false);
  h.element('replace-file').fire('click');
  assert.equal(h.element('submit').hidden, false);
  assert.equal(h.element('choose-audio').hidden, true);
  assert.equal(h.element('start').hidden, true);
});

test('invalid audio stays unselected and file input cannot interrupt capture', async () => {
  const h = setup();
  for (const file of [new File([], 'empty.wav'), new File(['text'], 'wrong.txt'), { name: 'large.wav', size: 26 * 1024 * 1024 }]) {
    h.element('audio-file').fire('change', { target: { files: [file] } });
    assert.equal(h.element('submit').hidden, true);
    assert.equal(h.XHR.last, undefined);
  }
  await h.element('start').fire('click');
  h.element('audio-file').fire('change', { target: { files: [new File(['audio'], 'sample.wav')] } });
  assert.equal(h.element('submit').hidden, true);
  assert.equal(h.element('audio-file').disabled, true);
  assert.equal(h.Recorder.last.state, 'recording');
  h.element('cancel').fire('click'); await settle();
});

test('late microphone permission result after cancel is released', async () => {
  let resolve;
  const h = setup(() => new Promise(r => { resolve = r; }));
  const pending = h.element('start').fire('click');
  h.element('cancel').fire('click'); resolve(h.stream); await pending;
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.Recorder.last, undefined);
});

test('permission denied is recoverable', async () => {
  const h = setup(async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); });
  await h.element('start').fire('click');
  assert.match(h.element('message').textContent, /权限被拒绝/);
  assert.equal(h.element('start').disabled, false);
});

test('three-minute timer stops and releases the recording', async () => {
  const h = setup(); await h.element('start').fire('click');
  [...h.timeouts.values()][0](); await settle();
  assert.equal(h.Recorder.last.state, 'inactive');
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.element('submit').disabled, false);
});

test('page exit discards recording and releases microphone', async () => {
  const h = setup(); await h.element('start').fire('click');
  h.windowEvents.pagehide(); await settle();
  assert.equal(h.stats().stopped, 1);
  assert.equal(h.stats().created, 0);
});

test('authorization and insecure context prevent capture', async () => {
  const h = setup(undefined, { acknowledge: false });
  await h.element('start').fire('click'); assert.equal(h.Recorder.last, undefined);
  h.element('acknowledge-usage').fire('click'); h.window.isSecureContext = false;
  await h.element('start').fire('click'); assert.match(h.element('message').textContent, /HTTPS/);
});

test('request failure preserves preview, clears result, and allows retry', async () => {
  const h = setup(); await h.element('start').fire('click'); h.element('stop').fire('click'); await settle();
  h.element('submit').fire('click'); h.XHR.last.onerror();
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('result').hidden, true);
  assert.equal(h.element('submit').disabled, false);
  h.element('submit').fire('click');
  h.XHR.last.status = 200;
  h.XHR.last.responseText = JSON.stringify({ score: .25, model_version: 'unit-test-only', audio_duration_seconds: 3, analysis_seconds: .1, warnings: [] });
  h.XHR.last.onload();
  assert.equal(h.element('result').hidden, false);
  assert.equal(h.element('score').textContent, '0.2500');
});

test('invalid success payload cannot display a report', async () => {
  const h = setup(); await h.element('start').fire('click'); h.element('stop').fire('click'); await settle();
  h.element('submit').fire('click'); h.XHR.last.status = 200; h.XHR.last.responseText = '{}'; h.XHR.last.onload();
  assert.equal(h.element('result').hidden, true);
  assert.equal(h.element('submit').disabled, false);
});


test('real input meter distinguishes silence, sound and near-clipping, then closes', async () => {
  const h = setup(); let amplitude = 0, closed = 0, disconnected = 0;
  h.window.AudioContext = class {
    state = 'running';
    createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData(samples) { samples.fill(amplitude); } }; }
    createMediaStreamSource() { return { connect() {}, disconnect() { disconnected++; } }; }
    close() { closed++; this.state = 'closed'; return Promise.resolve(); }
  };
  await h.element('start').fire('click');
  h.setNow(3000); [...h.timeouts.values()][0]();
  const tick = [...h.intervals.values()][0]; tick(); h.setNow(6200); tick();
  assert.match(h.element('level-hint').textContent, /未检测到/);
  amplitude = .1; tick(); assert.match(h.element('level-hint').textContent, /保持自然音量/);
  amplitude = 1; tick(); assert.match(h.element('level-hint').textContent, /接近上限/);
  h.element('stop').fire('click'); await settle();
  assert.equal(closed, 1); assert.equal(disconnected, 1);
  assert.equal(h.element('live-quality').hidden, true);
});

test('quality observations appear separately from the unchanged model score', async () => {
  const h = setup(); await h.element('start').fire('click'); h.element('stop').fire('click'); await settle();
  h.element('submit').fire('click'); h.XHR.last.status = 200;
  h.XHR.last.responseText = JSON.stringify({ score: .25, model_version: 'unit-test-only', audio_duration_seconds: 3, analysis_seconds: .1, warnings: [], audio_quality: { summary: '试听后决定是否重录', disclaimer: '仅为音量提示', issues: [{code:'low_volume',message:'音量低'}] } });
  h.XHR.last.onload();
  assert.equal(h.element('score').textContent, '0.2500');
  assert.equal(h.element('quality-result').hidden, false);
  assert.ok(h.element('quality-issues').children.some(item => item.textContent === '音量低'));
});

function respond(h, score = .5, issues = []) {
  h.element('submit').fire('click');
  h.XHR.last.status = 200;
  h.XHR.last.responseText = JSON.stringify({ score, model_version: 'test-only', audio_duration_seconds: 10, analysis_seconds: .1, audio_quality: { summary: '未发现明显音量异常', issues } });
  h.XHR.last.onload();
}

test('replacement cancellation, invalid files and denied permission keep original audio and result', async () => {
  let deny = false;
  const h = setup(async () => { if (deny) throw { name: 'NotAllowedError' }; return h.stream; });
  const file = new File(['original audio'], 'original.wav');
  h.element('audio-file').fire('change', { target: { files: [file] } });
  respond(h);
  h.element('replace-file').fire('click');
  h.element('choose-audio').fire('click');
  h.element('audio-file').fire('change', { target: { files: [] } });
  h.element('audio-file').fire('change', { target: { files: [new File([], 'empty.wav')] } });
  deny = true; await h.element('start').fire('click');
  assert.equal(h.element('file-name').textContent, 'original.wav');
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('result').hidden, false);
  assert.equal(h.stats().revoked, 0);
  respond(h); assert.equal(h.XHR.last.body.get('audio').name, 'original.wav');
});

test('successful replacement revokes only the old URL and removes its quality observations', async () => {
  const h = setup(); attachMeter(h, () => .04);
  await h.element('start').fire('click'); completeEnvironmentCheck(h);
  h.element('stop').fire('click'); await settle();
  respond(h);
  assert.equal(h.element('quality-result').properties.order, '1');
  assert.ok(h.element('quality-issues').children.some(item => item.textContent.includes('环境声可能偏大')));
  h.element('replace-file').fire('click');
  h.element('audio-file').fire('change', { target: { files: [new File(['new'], 'new.wav')] } });
  assert.equal(h.stats().revoked, 1);
  assert.equal(h.element('result').hidden, true);
  respond(h);
  assert.equal(h.element('quality-result').properties.order, '3');
  assert.equal(h.element('quality-issues').children.length, 0);
  assert.equal(h.XHR.last.body.get('audio').name, 'new.wav');
});

test('recording anomalies survive recovery and retry, with no duplicate messages', async () => {
  let amplitude = .001;
  const h = setup(); attachMeter(h, () => amplitude);
  await h.element('start').fire('click'); completeEnvironmentCheck(h);
  amplitude = 1; const tick = [...h.intervals.values()][0]; tick(); tick();
  amplitude = .1; tick();
  h.element('stop').fire('click'); await settle();
  respond(h);
  assert.equal(h.element('quality-result').properties.order, '1');
  assert.equal(h.element('quality-issues').children.filter(item => item.textContent.includes('接近上限')).length, 1);
  respond(h);
  assert.equal(h.element('quality-issues').children.filter(item => item.textContent.includes('接近上限')).length, 1);
});

test('water gauge matches score endpoints and midpoint without changing the model value', () => {
  const h = setup();
  h.element('audio-file').fire('change', { target: { files: [new File(['audio'], 'input.wav')] } });
  for (const [score, color] of [[0, 'rgb(46, 166, 119)'], [.5, 'rgb(232, 183, 48)'], [1, 'rgb(219, 76, 76)']]) {
    respond(h, score);
    assert.equal(h.element('score-gauge').properties['--fill'], `${score * 100}%`);
    assert.equal(h.element('score-gauge').properties['--water-color'], color);
    assert.equal(h.element('score').textContent, score.toFixed(4));
    assert.equal(h.element('score-gauge').classes.has('empty'), score === 0);
    assert.equal(h.element('score-gauge').classes.has('full'), score === 1);
  }
});

test('replacement recording keeps original on cancellation and replaces it only after stop', async () => {
  const h = setup();
  h.element('audio-file').fire('change', { target: { files: [new File(['original'], 'original.wav')] } });
  h.element('replace-file').fire('click');
  await h.element('start').fire('click');
  h.element('cancel').fire('click'); await settle();
  assert.equal(h.stats().revoked, 0);
  assert.equal(h.element('file-name').textContent, 'original.wav');
  assert.equal(h.element('preview').hidden, false);
  await h.element('start').fire('click');
  h.setNow(10000); [...h.intervals.values()][0]();
  h.element('stop').fire('click'); await settle();
  assert.equal(h.element('file-name').textContent, 'recording.webm');
  assert.equal(h.element('timer').textContent, '00:10');
  assert.equal(h.stats().revoked, 1);
  respond(h); assert.equal(h.XHR.last.body.get('audio').name, 'recording.webm');
});

test('cancelling replacement environment check preserves original and blocks stale callback', async () => {
  const h = setup(); attachMeter(h, () => .001);
  h.element('audio-file').fire('change', { target: { files: [new File(['original'], 'original.wav')] } });
  h.element('replace-file').fire('click'); await h.element('start').fire('click');
  const stale = [...h.timeouts.values()][0];
  h.element('cancel').fire('click'); stale();
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.Recorder.last.state, 'inactive');
  assert.equal(h.stats().revoked, 0);
  respond(h); assert.equal(h.XHR.last.body.get('audio').name, 'original.wav');
});

test('separate rerecord button begins capture while cancellation preserves the previous file', async () => {
  const h = setup();
  h.element('audio-file').fire('change', { target: { files: [new File(['original'], 'original.wav')] } });
  await h.element('reset').fire('click');
  assert.equal(h.Recorder.last.state, 'recording');
  assert.equal(h.element('replace-file').disabled, true);
  h.element('cancel').fire('click'); await settle();
  assert.equal(h.element('preview').hidden, false);
  assert.equal(h.element('file-name').textContent, 'original.wav');
  assert.equal(h.stats().revoked, 0);
});

test('SVG has a single colored numeral over a crisp pale-gray disc and exact empty/full bounds', () => {
  const {wavePath} = require('../web/liquid-gauge.js');
  const points = path => [...path.matchAll(/(?:M|L)(\d+),([\d.-]+)/g)].slice(0,121).map(match => Number(match[2]));
  assert.ok(points(wavePath(0, 2)).every(y => y === 230));
  assert.ok(points(wavePath(1, 2)).every(y => y === 10));
  for (const phase of [0, 1, 3]) {
    const surface = points(wavePath(.5, phase));
    assert.ok(Math.min(...surface) >= 116 && Math.max(...surface) <= 124);
  }
  const h = setup();
  h.element('audio-file').fire('change', { target: { files: [new File(['a'], 'a.wav')] } });
  respond(h, .5);
  const svg = h.element('score-gauge').children[0];
  assert.match(svg.innerHTML, /class="liquid-water" href="#liquid-1-wave"/);
  assert.doesNotMatch(svg.innerHTML, /feGaussianBlur|<filter/);
  assert.match(svg.innerHTML, /<circle class="liquid-backing" cx="120" cy="120" r="88" fill="#f3f7fa"/);
  assert.equal((svg.innerHTML.match(/<text /g) || []).length, 1);
  assert.equal(svg.querySelector('.liquid-number').textContent, '0.5000');
});
