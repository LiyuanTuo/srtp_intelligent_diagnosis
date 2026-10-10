'use strict';
// Project-defined UI heuristics, not a validated tongue-image quality classifier.
(function (root) {
  function crop(width, height) {
    const w = Math.min(width, height * 4 / 3), h = w * 3 / 4;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
  }
  function brightness(data) {
    let sum = 0, bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
      sum += y;
      if (y > 245) bright++;
    }
    const count = data.length / 4;
    if (!count) return 'unknown';
    if (sum / count < 55) return 'dark';
    if (sum / count > 220 || bright / count > .25) return 'bright';
    return 'neutral';
  }
  const api = { crop, brightness };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TongueQuality = api;
})(globalThis);
