'use strict';
const slider = document.getElementById('demo-score');
const presets = [...document.querySelectorAll('[data-value]')];
function updateDemo(value) {
  slider.value = String(value);
  document.getElementById('demo-value').textContent = value.toFixed(4);
  LiquidGauge.render(document.getElementById('demo-gauge'), value);
  document.getElementById('demo-gauge').setAttribute('aria-label', `演示分数 ${value.toFixed(4)}`);
  presets.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.value) === value)));
}
slider.addEventListener('input', () => updateDemo(Number(slider.value)));
presets.forEach(button => button.addEventListener('click', () => updateDemo(Number(button.dataset.value))));
updateDemo(.5);
[['demo-low', .15], ['demo-mid', .5], ['demo-high', .85]].forEach(([id, value]) => {
  const root = document.getElementById(id); LiquidGauge.render(root, value);
  root.setAttribute('aria-label', `演示分数 ${value.toFixed(4)}`);
});
