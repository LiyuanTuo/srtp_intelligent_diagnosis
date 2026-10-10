'use strict';
// API usage reference: WebRTC samples, getusermedia/canvas/js/main.js (BSD-3-Clause).
// Independently implemented capture workflow. Scope and links: SOURCES.md, tongue section.
(() => {
  const el = id => document.getElementById(id);
  const video = el('camera-video');
  const checks = ['check-complete', 'check-sharp', 'check-light'];
  let state = 'idle', stream = null, generation = 0, facing = 'user', mirrored = true;
  let lightTimer = null, countdownTimer = null, url = null, photo = null;
  const sample = document.createElement('canvas');
  sample.width = 64; sample.height = 64;
  const sampleContext = sample.getContext('2d', { willReadFrequently: true });
  const lightText = {
    dark: '画面中央偏暗，请面向柔和白光，避免背光。',
    bright: '画面中央偏亮，请避开直射强光，检查舌面反光。',
    neutral: '请继续检查舌面光线是否均匀，并将舌头对准轮廓。',
    unknown: '暂时无法估计亮度，请自行检查光线是否均匀。',
  };
  function message(text = '', error = false) {
    el('tongue-message').textContent = text;
    el('tongue-message').hidden = !text;
    el('tongue-message').classList.toggle('error', error);
  }
  function render() {
    const live = ['live', 'countdown', 'encoding'].includes(state);
    const busy = ['permission', 'loading', 'countdown', 'encoding'].includes(state);
    const reviewing = state === 'review', complete = state === 'complete';
    el('camera-placeholder').hidden = live || !!photo;
    video.hidden = !live;
    el('tongue-photo').hidden = !photo;
    el('alignment-guide').hidden = !!photo;
    el('viewfinder').classList.toggle('live', live);
    el('open-camera').hidden = live || !!photo;
    el('open-camera').disabled = busy;
    el('open-camera').textContent = state === 'permission' ? '正在等待相机权限…' : '开启相机';
    el('take-photo').hidden = !live;
    el('take-photo').disabled = state !== 'live';
    el('switch-camera').hidden = !live;
    el('switch-camera').disabled = busy;
    el('close-camera').hidden = !(live || state === 'permission');
    el('close-camera').textContent = state === 'countdown' ? '取消拍照 / 关闭相机' : '关闭相机';
    el('camera-controls').hidden = !!photo;
    el('import-controls').hidden = !!photo;
    el('choose-photo').disabled = busy;
    el('photo-file').disabled = busy;
    el('preview-label').hidden = !live;
    el('preview-label').textContent = mirrored ? '镜像预览 · 成片为正常方向' : '相机实时预览';
    video.classList.toggle('mirrored', mirrored);
    el('live-hint').hidden = !!photo;
    el('photo-review').hidden = !reviewing;
    el('photo-complete').hidden = !complete;
    el('confirm-photo').disabled = !reviewing || !checks.every(id => el(id).checked);
    el('camera-state').textContent = ({ idle: '相机未开启', permission: '等待授权', live: '相机已开启', countdown: '准备拍照', encoding: '正在生成照片', loading: '正在读取照片', review: '等待人工检查', complete: '已确认 · 仅本页' })[state];
    el('capture-title').textContent = photo ? '检查你的舌像' : '让舌头完整入框';
    el('camera-instruction').textContent = photo ? '先让舌头休息，再放大检查照片的细节。' : live ? '自然伸舌，对齐虚线；准备好后点击「3 秒后拍照」。' : '先调整光线，再开启相机。准备好后再伸舌。';
    const step = photo ? 3 : live ? 2 : 1;
    [1, 2, 3].forEach(n => {
      el(`tongue-step-${n}`).classList.toggle('current', n === step);
      if (n === step) el(`tongue-step-${n}`).setAttribute('aria-current', 'step');
      else el(`tongue-step-${n}`).removeAttribute('aria-current');
    });
  }
  function stopCamera() {
    generation++;
    clearInterval(lightTimer); clearInterval(countdownTimer);
    lightTimer = countdownTimer = null;
    el('countdown').hidden = true;
    const previous = stream; stream = null;
    if (previous) previous.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }
  function clearPhoto() {
    el('photo-dialog').close();
    ['tongue-photo', 'large-photo'].forEach(id => el(id).removeAttribute('src'));
    el('download-photo').removeAttribute('href');
    if (url) URL.revokeObjectURL(url);
    url = null; photo = null;
    checks.forEach(id => { el(id).checked = false; });
  }
  function reset() {
    stopCamera(); clearPhoto(); state = 'idle';
    el('light-hint').textContent = '面向柔和白光，避开背光和直射强光。';
    el('live-hint').classList.remove('attention');
    message(); render(); el('open-camera').focus();
  }
  function estimate(source, width, height, camera = false) {
    if (!sampleContext || !width || !height) return 'unknown';
    // Camera ROI covers the overlay region; imported images use the image center.
    const area = camera ? TongueQuality.crop(width, height) : { x: 0, y: 0, width, height };
    try {
      sampleContext.drawImage(source, area.x + area.width * .4, area.y + area.height * (camera ? .44 : .3), area.width * .2, area.height * .3, 0, 0, 64, 64);
      return TongueQuality.brightness(sampleContext.getImageData(0, 0, 64, 64).data);
    } catch { return 'unknown'; }
  }
  function updateLight() {
    const level = estimate(video, video.videoWidth, video.videoHeight, true);
    el('light-hint').textContent = `亮度粗略提示：${lightText[level]}`;
    el('live-hint').classList.toggle('attention', level === 'dark' || level === 'bright');
  }
  async function openCamera() {
    if (['permission', 'loading', 'countdown', 'encoding'].includes(state)) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      message('此环境无法开启相机。请用 HTTPS 或本机 localhost 访问，也可从相册选择照片。', true); return;
    }
    stopCamera(); const token = generation;
    state = 'permission'; message(); render();
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1600 }, height: { ideal: 1200 } } });
      if (token !== generation) { input.getTracks().forEach(track => track.stop()); return; }
      stream = input;
      const track = input.getVideoTracks()[0];
      const actualFacing = track.getSettings?.().facingMode;
      mirrored = actualFacing ? actualFacing === 'user' : facing === 'user';
      track.addEventListener('ended', () => {
        if (stream !== input) return;
        stopCamera(); state = 'idle'; render();
        message('相机连接已中断，请重新开启相机或选择照片。', true);
      });
      video.srcObject = input;
      await video.play();
      if (token !== generation) return;
      if (!video.videoWidth || !video.videoHeight) throw new Error('NoFrame');
      state = 'live'; render(); updateLight();
      lightTimer = setInterval(updateLight, 900);
      el('take-photo').focus();
      if (actualFacing && actualFacing !== facing) message('设备未提供所选方向的摄像头，已使用可用相机。');
    } catch (error) {
      if (token !== generation) return;
      stopCamera(); state = 'idle'; render();
      const errors = { NotAllowedError: '相机权限未获允许。请在浏览器中允许访问后重试，或从相册选择照片。', NotFoundError: '没有找到相机。请连接摄像头，或从相册选择照片。', NotReadableError: '相机可能被其他程序占用。请关闭占用程序后重试。', OverconstrainedError: '相机不支持当前设置，请尝试其他设备或选择照片。' };
      message(errors[error.name] || '无法读取相机画面，请重试或从相册选择照片。', true);
    }
  }
  function showPhoto(blob, width, height, level, imported) {
    clearPhoto();
    photo = blob; url = URL.createObjectURL(blob);
    el('tongue-photo').src = url; el('large-photo').src = url;
    el('download-photo').href = url;
    el('download-photo').download = `tongue-${new Date().toISOString().replace(/[:.]/g, '-')}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
    el('photo-meta').textContent = `${imported ? '已选择照片' : '相机拍摄 · 正常方向'} · ${width} × ${height} · ${(blob.size / 1024 / 1024).toFixed(2)} MB`;
    let quality = level === 'dark' ? '中央画面偏暗，建议改善光线后重拍。' : level === 'bright' ? '中央画面偏亮，请检查是否有过曝或大片反光。' : '请重点检查舌面纹理、完整度和光线。';
    if (Math.min(width, height) < 480) quality = '照片分辨率较低，建议靠近一些或使用更清晰的照片。' + quality;
    el('photo-quality').textContent = quality + ' 这些是粗略提示，是否适合保留需要你对照照片确认。';
    state = 'review'; message(); render(); el('photo-review').focus();
  }
  function capture() {
    if (state !== 'countdown') return;
    clearInterval(countdownTimer); countdownTimer = null; el('countdown').hidden = true;
    const token = generation;
    state = 'encoding'; render();
    try {
      if (!video.videoWidth || !video.videoHeight) throw new Error('NoFrame');
      // Capture exactly the 4:3 visible crop; never burn the guide into the photo.
      // CSS mirrors preview only. The saved image retains the camera's orientation.
      const area = TongueQuality.crop(video.videoWidth, video.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(Math.min(1920, area.width)); canvas.height = Math.round(canvas.width * 3 / 4);
      canvas.getContext('2d').drawImage(video, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
      const level = estimate(canvas, canvas.width, canvas.height, true);
      // Release the camera immediately after copying the frame, before encoding.
      stopCamera(); const encodingToken = generation;
      canvas.toBlob(blob => {
        if (encodingToken !== generation) return;
        if (!blob) { state = 'idle'; render(); message('照片生成失败，请重新开启相机拍摄。', true); return; }
        showPhoto(blob, canvas.width, canvas.height, level, false);
      }, 'image/jpeg', .95);
    } catch {
      if (token !== generation && state !== 'encoding') return;
      stopCamera(); state = 'idle'; render(); message('拍照未完成，请重新开启相机。', true);
    }
  }
  function beginCountdown() {
    if (state !== 'live') return;
    state = 'countdown'; let remaining = 3;
    el('countdown').textContent = String(remaining); el('countdown').hidden = false;
    message(); render();
    countdownTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) capture();
      else el('countdown').textContent = String(remaining);
    }, 1000);
  }
  async function importPhoto() {
    const file = el('photo-file').files?.[0]; el('photo-file').value = '';
    if (!file || !['idle', 'live'].includes(state)) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024) {
      message('请选择不超过 15 MB 的 JPG、PNG 或 WebP 照片。HEIC 请先转换为 JPG。', true); return;
    }
    stopCamera(); const token = generation; state = 'loading'; message(); render();
    const temporaryUrl = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = temporaryUrl;
      await img.decode();
      if (token !== generation) return;
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 24000000) throw new Error('dimensions');
      showPhoto(file, img.naturalWidth, img.naturalHeight, estimate(img, img.naturalWidth, img.naturalHeight), true);
    } catch {
      if (token !== generation) return;
      state = 'idle'; render(); message('无法读取这张照片，或图片超过 2400 万像素。请换一张 JPG、PNG 或 WebP 照片。', true);
    } finally { URL.revokeObjectURL(temporaryUrl); }
  }
  el('open-camera').addEventListener('click', openCamera);
  el('take-photo').addEventListener('click', beginCountdown);
  el('switch-camera').addEventListener('click', () => { if (state !== 'live') return; facing = facing === 'user' ? 'environment' : 'user'; openCamera(); });
  el('close-camera').addEventListener('click', () => { stopCamera(); state = 'idle'; render(); message('相机已关闭，可以重新开启或选择照片。'); });
  el('choose-photo').addEventListener('click', () => el('photo-file').click());
  el('photo-file').addEventListener('change', importPhoto);
  checks.forEach(id => el(id).addEventListener('change', render));
  el('confirm-photo').addEventListener('click', () => {
    if (state !== 'review' || !checks.every(id => el(id).checked)) return;
    state = 'complete'; render(); el('photo-complete').focus();
  });
  el('retake-photo').addEventListener('click', reset);
  el('new-photo').addEventListener('click', reset);
  el('enlarge-photo').addEventListener('click', () => { if (photo) el('photo-dialog').showModal(); });
  el('close-photo-dialog').addEventListener('click', () => el('photo-dialog').close());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !['permission', 'live', 'countdown', 'encoding'].includes(state)) return;
    stopCamera(); state = 'idle'; render(); message('页面切到后台，相机已关闭。请重新开启后拍照。');
  });
  window.addEventListener('pagehide', () => { stopCamera(); clearPhoto(); state = 'idle'; render(); });
  render();
})();
