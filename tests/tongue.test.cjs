// Deterministic media adapters verify races and cleanup, not physical camera quality.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const quality = require('../web/tongue-quality.js');

function setup(options = {}) {
  const ids = new Set([...fs.readFileSync('web/tongue.html', 'utf8').matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const nodes = new Map(), events = {}, timers = new Map(), created = [], revoked = [], encoders = [];
  let stops = 0, timerId = 0, requests = 0;
  class Element {
    constructor() { this.events = {}; this.hidden = false; this.disabled = false; this.checked = false; this.videoWidth = 1600; this.videoHeight = 900; this.classList = { toggle() {}, remove() {} }; }
    addEventListener(name, fn) { this.events[name] = fn; }
    fire(name, arg = {}) { return this.events[name]?.(arg); }
    setAttribute() {} removeAttribute(name) { delete this[name]; } focus() {} click() {}
    close() { this.open = false; } showModal() { this.open = true; }
    async play() { if (options.playError) throw new Error('play'); }
    getContext() { return { drawImage() {}, getImageData: () => ({ data: [120, 120, 120, 255] }) }; }
    toBlob(fn) { if (options.deferEncoding) encoders.push(fn); else fn(new Blob(['jpeg'], { type: 'image/jpeg' })); }
  }
  const element = id => { assert.ok(ids.has(id), `Missing HTML ID: ${id}`); if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const track = { stop() { stops++; }, getSettings: () => ({ facingMode: 'user' }), addEventListener: (name, fn) => { events['track-' + name] = fn; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const document = { hidden: false, getElementById: element, createElement: () => new Element(), addEventListener: (name, fn) => { events[name] = fn; } };
  class Image {
    constructor() { this.naturalWidth = options.imageWidth || 1200; this.naturalHeight = 900; }
    async decode() { if (options.decodeError) throw new Error('decode'); }
  }
  const context = vm.createContext({
    document, Image, Blob, TongueQuality: quality,
    window: { isSecureContext: options.secure !== false, addEventListener: (name, fn) => { events[name] = fn; } },
    navigator: { mediaDevices: { getUserMedia: async constraints => { requests++; assert.equal(constraints.audio, false); return options.getMedia ? options.getMedia() : stream; } } },
    URL: { createObjectURL() { const url = 'blob:' + created.length; created.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
    setInterval: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearInterval: id => timers.delete(id),
  });
  vm.runInContext(fs.readFileSync('web/tongue.js', 'utf8'), context);
  return { element, events, timers, stream, document, created, revoked, encoders, stats: () => ({ stops, requests }),
    shoot() { element('take-photo').fire('click'); const countdown = [...timers.values()].find(t => t.ms === 1000); for (let i = 0; i < 3; i++) countdown.fn(); },
    checkAll() { for (const id of ['check-complete', 'check-sharp', 'check-light']) { element(id).checked = true; element(id).fire('change'); } },
    import(file) { element('photo-file').files = [file]; return element('photo-file').fire('change'); },
  };
}

test('camera requires a click; insecure contexts never request permission', async () => {
  const h = setup({ secure: false }); assert.equal(h.stats().requests, 0);
  await h.element('open-camera').fire('click'); assert.equal(h.stats().requests, 0);
  assert.match(h.element('tongue-message').textContent, /HTTPS/);
});
test('late permission after cancel releases the acquired camera', async () => {
  let resolve; const h = setup({ getMedia: () => new Promise(r => { resolve = r; }) });
  const pending = h.element('open-camera').fire('click');
  h.element('close-camera').fire('click'); resolve(h.stream); await pending;
  assert.equal(h.stats().stops, 1); assert.equal(h.element('take-photo').hidden, true);
});
test('permission and playback failures recover without holding the device', async () => {
  const denied = setup({ getMedia: () => { throw { name: 'NotAllowedError' }; } });
  await denied.element('open-camera').fire('click');
  assert.match(denied.element('tongue-message').textContent, /权限/);
  assert.equal(denied.element('open-camera').disabled, false);
  const failed = setup({ playError: true }); await failed.element('open-camera').fire('click');
  assert.equal(failed.stats().stops, 1); assert.equal(failed.element('camera-video').srcObject, null);
});
test('capture stops camera, requires all manual checks, and retake releases photo', async () => {
  const h = setup(); await h.element('open-camera').fire('click'); h.shoot();
  assert.equal(h.stats().stops, 1); assert.equal(h.timers.size, 0);
  assert.equal(h.element('photo-review').hidden, false);
  assert.equal(h.element('confirm-photo').disabled, true);
  h.element('confirm-photo').fire('click'); assert.equal(h.element('photo-complete').hidden, true);
  h.checkAll(); assert.equal(h.element('confirm-photo').disabled, false);
  h.element('confirm-photo').fire('click'); assert.equal(h.element('photo-complete').hidden, false);
  h.element('new-photo').fire('click'); assert.deepEqual(h.revoked, h.created);
  assert.equal(h.element('check-complete').checked, false);
});
test('background cancels countdown and interruption releases tracks', async () => {
  const h = setup(); await h.element('open-camera').fire('click'); h.element('take-photo').fire('click');
  h.document.hidden = true; h.events.visibilitychange();
  assert.equal(h.timers.size, 0); assert.equal(h.created.length, 0); assert.equal(h.stats().stops, 1);
  h.document.hidden = false; await h.element('open-camera').fire('click'); h.events['track-ended']();
  assert.equal(h.element('take-photo').hidden, true); assert.match(h.element('tongue-message').textContent, /中断/);
});
test('late JPEG encoding after page exit cannot restore a discarded photo', async () => {
  const h = setup({ deferEncoding: true }); await h.element('open-camera').fire('click'); h.shoot();
  h.events.pagehide(); h.encoders[0](new Blob(['jpeg'], { type: 'image/jpeg' }));
  assert.equal(h.created.length, 0); assert.equal(h.element('photo-review').hidden, true);
});
test('image selection validates type, size and decode; successful import is local and revocable', async () => {
  const h = setup();
  await h.import({ size: 1, type: 'image/heic' }); assert.equal(h.created.length, 0);
  await h.import({ size: 16 * 1024 * 1024, type: 'image/jpeg' }); assert.equal(h.created.length, 0);
  await h.import(new Blob(['png'], { type: 'image/png' }));
  assert.equal(h.stats().requests, 0); assert.equal(h.element('photo-review').hidden, false);
  assert.match(h.element('download-photo').download, /\.png$/);
  h.events.pagehide(); assert.deepEqual([...h.revoked].sort(), [...h.created].sort());
  for (const options of [{ decodeError: true }, { imageWidth: 30000 }]) {
    const bad = setup(options); await bad.import(new Blob(['bad'], { type: 'image/jpeg' }));
    assert.equal(bad.element('photo-review').hidden, true); assert.deepEqual(bad.revoked, bad.created);
  }
});
test('4:3 crop matches the visible frame for landscape and portrait cameras', () => {
  assert.deepEqual(quality.crop(1600, 900), { x: 200, y: 0, width: 1200, height: 900 });
  assert.deepEqual(quality.crop(900, 1600), { x: 0, y: 462.5, width: 900, height: 675 });
});
test('brightness warns on dark/white regions without claiming recognition or acceptance', () => {
  assert.equal(quality.brightness([0, 0, 0, 255]), 'dark');
  assert.equal(quality.brightness([255, 255, 255, 255]), 'bright');
  assert.equal(quality.brightness([125, 125, 125, 255]), 'neutral');
  assert.equal(quality.brightness([]), 'unknown');
});
