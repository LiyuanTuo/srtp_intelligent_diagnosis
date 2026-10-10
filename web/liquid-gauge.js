'use strict';
// One renderer shared by the real result and the interactive design demo.
(() => {
  let nextId = 0;
  const instances = new WeakMap();
  function color(value) {
    const stops = [[46, 166, 119], [232, 183, 48], [219, 76, 76]];
    const half = value <= .5 ? 0 : 1, fraction = half === 0 ? value * 2 : (value - .5) * 2;
    return `rgb(${stops[half].map((channel, i) => Math.round(channel + (stops[half + 1][i] - channel) * fraction)).join(', ')})`;
  }
  function wavePath(value, phase) {
    // Interior runs from y=10 to y=230. Taper the wave at empty/full endpoints.
    const level = 230 - value * 220;
    const amplitude = Math.min(4, value * 220, (1 - value) * 220);
    const points = [];
    for (let x = 0; x <= 240; x += 2) points.push(`${x},${(level + amplitude * Math.sin(x / 240 * Math.PI * 4 + phase)).toFixed(3)}`);
    return `M${points.join(' L')} L240,240 L0,240 Z`;
  }
  function render(root, value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('Score must be between 0 and 1.');
    let item = instances.get(root);
    if (!item) {
      const id = `liquid-${++nextId}`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'liquid-svg'); svg.setAttribute('viewBox', '0 0 240 240'); svg.setAttribute('aria-hidden', 'true');
      svg.innerHTML = `<defs><clipPath id="${id}-circle"><circle cx="120" cy="120" r="110"/></clipPath><path id="${id}-wave"/></defs><circle class="liquid-outline" cx="120" cy="120" r="118" fill="white" stroke-width="2"/><g clip-path="url(#${id}-circle)"><circle cx="120" cy="120" r="110" fill="#f3f7fa"/><use class="liquid-water" href="#${id}-wave"/><circle class="liquid-backing" cx="120" cy="120" r="88" fill="#f3f7fa"/><text class="liquid-number" x="120" y="122" text-anchor="middle" dominant-baseline="middle"></text></g>`;
      root.append(svg);
      item = { svg, wave: svg.querySelector('defs path'), current: 0, target: value, start: 0, started: performance.now(), frame: null };
      instances.set(root, item);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      const draw = now => {
        const progress = reduced?.matches ? 1 : Math.min(1, (now - item.started) / 700);
        item.current = item.start + (item.target - item.start) * (1 - (1 - progress) ** 3);
        item.wave.setAttribute('d', wavePath(item.current, reduced?.matches ? 0 : now / 650));
        const tint = color(item.current);
        svg.querySelector('.liquid-water').setAttribute('fill', tint);
        svg.querySelector('.liquid-outline').setAttribute('stroke', tint);
        svg.querySelector('.liquid-number').setAttribute('fill', tint);
        if (!reduced?.matches && root.isConnected && root.getClientRects().length) item.frame = requestAnimationFrame(draw);
        else item.frame = null;
      };
      item.draw = draw;
    }
    item.start = item.current; item.target = value; item.started = performance.now();
    item.svg.querySelector('.liquid-number').textContent = value.toFixed(4);
    root.style.setProperty('--water-color', color(value)); root.style.setProperty('--fill', `${value * 100}%`);
    root.classList.toggle('empty', value === 0); root.classList.toggle('full', value === 1);
    root.setAttribute('aria-label', `研究模型分数 ${value.toFixed(4)}`);
    if (item.frame !== null) cancelAnimationFrame(item.frame);
    // Schedule after a hidden result card has been revealed by its caller.
    item.frame = requestAnimationFrame(item.draw);
  }
  const api = { render, color, wavePath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.LiquidGauge = api;
})();
