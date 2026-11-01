import { formatValue, parseValue, uiScale, type NumberParamDef } from '../../app/params';
import type { ParamStore } from '../../app/store';
import { h, nextId, type Component } from '../dom';
import type { CapColour } from '../controlStyle';

const SWEEP = 270;
const TICKS = 11;
/** Pixels of vertical drag for a full sweep. Shift = 5x finer. */
const DRAG_PX = 200;
const NS = 'http://www.w3.org/2000/svg';

const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Value chip text in the design's style: uppercase, "x" for times. */
export const chipText = (t: string) => t.replace('×', 'X').toUpperCase();

/**
 * Rotary encoder (design 84:11425 and 84:12498): tick scale ring (11 dots over 270 degrees,
 * lit up to the value), a sunk well, a coloured cap with a pointer, the short legend and a
 * value chip. Works on the param's panel scale (0..10 for norm10 params) via uiScale.
 *
 * Input: vertical drag (Shift = fine), wheel, arrow keys / PageUp / PageDown / Home / End
 * (Shift = x10) on the visually hidden native range input that carries focus and
 * accessibility, double-click resets, click the chip to type a value (Enter / Escape).
 */
export function createDial(def: NumberParamDef, store: ParamStore, legend: string, cap: CapColour): Component {
  const id = def.id;
  const inputId = nextId(`p-${id}`);
  const scale = uiScale(def);
  const span = scale.max - scale.min;

  const range = h('input', {
    class: 'sr-only', type: 'range', id: inputId, min: scale.min, max: scale.max, step: scale.step,
    'aria-label': def.label,
  });

  const ring = s('svg', { class: 'dial-ring', width: 58, height: 58, viewBox: '0 0 58 58', 'aria-hidden': 'true' });
  const ticks: SVGCircleElement[] = [];
  for (let i = 0; i < TICKS; i++) {
    const a = ((-SWEEP / 2 + (i / (TICKS - 1)) * SWEEP) * Math.PI) / 180;
    const end = i === 0 || i === (TICKS - 1) / 2 || i === TICKS - 1; // min, centre, max are larger
    // Centres snapped to pixel centres so the 1.6 px dots stay crisp dots at 1x.
    const snap = (v: number) => Math.round(v - 0.5) + 0.5;
    const c = s('circle', { cx: snap(29 + 27.6 * Math.sin(a)), cy: snap(29 - 27.6 * Math.cos(a)), r: end ? 1.3 : 1, 'shape-rendering': end ? 'auto' : 'crispEdges' });
    ticks.push(c);
    ring.append(c);
  }
  const pointer = s('svg', { class: 'dial-pointer', width: 58, height: 58, viewBox: '0 0 58 58', 'aria-hidden': 'true' });
  pointer.append(s('line', { x1: 29, y1: 11.4, x2: 29, y2: 19.2, 'stroke-width': 2.5 }));

  const enc = h('div', { class: `dial-enc cap-${cap}`, title: `${def.label}: drag, scroll or use arrow keys. Double-click resets.` },
    ring,
    h('span', { class: 'dial-well' }),
    h('span', { class: 'dial-knob' }, h('span', { class: 'dial-cap' }), pointer),
    range,
  );

  const chip = h('button', { type: 'button', class: 'dial-chip', 'aria-label': `${def.label} value, click to type` });
  const field = h('input', {
    class: 'dial-chip dial-chip-field', type: 'text', inputmode: 'decimal', spellcheck: 'false', autocomplete: 'off',
    'aria-label': `${def.label} value`, hidden: true,
  });

  const paint = (v: number) => {
    const u = scale.toUi(v);
    const t = Math.min(1, Math.max(0, (u - scale.min) / span));
    pointer.style.transform = `rotate(${-SWEEP / 2 + t * SWEEP}deg)`;
    ticks.forEach((c, i) => c.classList.toggle('on', i <= t * (TICKS - 1) + 1e-6));
    range.value = String(u);
    range.setAttribute('aria-valuetext', scale.text(v));
    chip.textContent = chipText(scale.text(v));
    chip.title = def.display ? formatValue(def, v) : '';
  };

  const setUi = (u: number) => store.set(id, scale.fromUi(Math.min(scale.max, Math.max(scale.min, u))));
  /** Step from the shown (rounded) value so steps land on the display grid. */
  const nudge = (steps: number) => {
    const shown = Math.round(scale.toUi(store.num(id)) / scale.step) * scale.step;
    setUi(shown + steps * scale.step);
  };

  range.addEventListener('input', () => store.set(id, scale.fromUi(Number(range.value))));
  range.addEventListener('keydown', (e) => {
    const big = Math.max(1, Math.round(span / scale.step / 10));
    const mult = e.shiftKey ? 10 : 1;
    let handled = true;
    switch (e.key) {
      case 'ArrowUp': case 'ArrowRight': nudge(mult); break;
      case 'ArrowDown': case 'ArrowLeft': nudge(-mult); break;
      case 'PageUp': nudge(big); break;
      case 'PageDown': nudge(-big); break;
      case 'Home': setUi(scale.min); break;
      case 'End': setUi(scale.max); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  let startY = 0;
  let startU = 0;
  enc.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    enc.setPointerCapture(e.pointerId);
    enc.classList.add('is-turning');
    startY = e.clientY;
    startU = scale.toUi(store.num(id));
    range.focus({ preventScroll: true });
  });
  enc.addEventListener('pointermove', (e) => {
    if (!enc.hasPointerCapture(e.pointerId)) return;
    const fine = e.shiftKey ? 0.2 : 1;
    setUi(startU + ((startY - e.clientY) / DRAG_PX) * span * fine);
  });
  const end = (e: PointerEvent) => {
    if (enc.hasPointerCapture(e.pointerId)) enc.releasePointerCapture(e.pointerId);
    enc.classList.remove('is-turning');
  };
  enc.addEventListener('pointerup', end);
  enc.addEventListener('pointercancel', end);
  enc.addEventListener('dblclick', () => store.set(id, store.defaultOf(id)));
  let wheelAcc = 0;
  enc.addEventListener('wheel', (e) => {
    e.preventDefault();
    // A mouse notch (|delta| >= 50 in one event) is one step; trackpads send many small
    // deltas, accumulated at one step per 40 px.
    if (e.deltaMode === 0 && Math.abs(e.deltaY) < 50) wheelAcc += e.deltaY;
    else wheelAcc = Math.sign(e.deltaY) * 40;
    const steps = Math.trunc(wheelAcc / 40);
    if (!steps) return;
    wheelAcc -= steps * 40;
    nudge(-steps * (e.shiftKey ? 10 : 1));
  }, { passive: false });

  // Type-in: the chip swaps for a text field.
  const openField = () => {
    field.value = scale.text(store.num(id)).replace(/[^\d.\-k]/gi, '');
    chip.hidden = true;
    field.hidden = false;
    field.focus();
    field.select();
  };
  const closeField = (commit: boolean) => {
    if (field.hidden) return;
    if (commit) {
      const u = parseValue(field.value);
      if (!Number.isNaN(u)) setUi(u);
    }
    field.hidden = true;
    chip.hidden = false;
  };
  chip.addEventListener('click', openField);
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeField(true); chip.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeField(false); chip.focus(); }
  });
  field.addEventListener('blur', () => closeField(true));

  const el = h('div', { class: 'dial' },
    enc,
    h('label', { class: 'dial-label', for: inputId }, legend),
    h('span', { class: 'dial-value' }, chip, field),
  );
  const unwatch = store.watch<number>(id, paint);
  return { el, dispose: unwatch };
}
