// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { formatValue, uiScale, type ColorParamDef, type NumberParamDef, type ToggleParamDef } from '../../../app/params';
import type { ParamStore } from '../../../app/store';
import { h, nextId, type Component } from '../../dom';
import type { DropdownLook } from '../../components/Dropdown';

/*
 * Braun controls (Figma "Braun — Components" 250:2). Geometry is the design's, in px; colours,
 * gradients and shadows are the skin tokens (braun-tokens.css) used in braun.css.
 */

const NS = 'http://www.w3.org/2000/svg';
const s = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Filled triangle caret (dropdown 257:1369: 6 x 3.5 in a 16 px box). */
export const CARET = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 7h6l-3 3.5z" fill="currentColor"/></svg>';

/** Info icon (254:1207, 12 px): ring r 5.3, stem, dot. */
export const INFO_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="5.3" stroke="currentColor" stroke-width="1.2"/><rect x="5.4" y="5" width="1.2" height="4" fill="currentColor"/><circle cx="6" cy="3.3" r="0.8" fill="currentColor"/></svg>';

/** Section header (257:3706): title, 1 px rule. */
export function header(id: string, title: string): HTMLElement {
  return h('h2', { class: 'bn-head', id }, h('span', { class: 'bn-head-title' }, title), h('span', { class: 'bn-head-rule', 'aria-hidden': 'true' }));
}

// ---------------------------------------------------------------- keys

export interface BnKeyOpts { label: string; onClick?: () => void; tip?: string; ariaLabel?: string; disabled?: boolean }

const guardClick = (b: HTMLButtonElement, fn?: () => void) => b.addEventListener('click', (e) => {
  if (b.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
  fn?.();
});

/** Action key (254:1237, software: a momentary command): label above a 24 px round key in a recess. */
export function actionKey(o: BnKeyOpts): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'bn-action', 'aria-label': o.ariaLabel, 'data-tip': o.tip },
    h('span', { class: 'bn-label' }, o.label),
    h('span', { class: 'bn-round', 'aria-hidden': 'true' }, h('span', { class: 'bn-dome' })));
  if (o.disabled) b.setAttribute('aria-disabled', 'true');
  guardClick(b, o.onClick);
  return b;
}

/** Listen key (254:1269): the green power key, LED above; latching (aria-pressed). */
export function listenKey(onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: 'bn-listen', 'aria-pressed': 'false', 'data-tip': 'Start or stop listening (Space)' },
    h('span', { class: 'bn-label' }, 'listen'),
    h('span', { class: 'bn-led', 'aria-hidden': 'true' }),
    h('span', { class: 'bn-power', 'aria-hidden': 'true' }, h('span', { class: 'bn-power-dome' })));
  b.addEventListener('click', onClick);
  return b;
}

export interface SelectorOption<T extends string> { value: T; label: string; ariaLabel?: string }

/**
 * Selector keys (256:1248, hardware: they hold a state): capsule keys with an LED and a label
 * above, as a radio group (roving tabindex, arrow keys).
 */
export function selectorGroup<T extends string>(
  options: readonly SelectorOption<T>[], initial: T, onChange: (v: T) => void, ariaLabel: string,
): Component & { set(v: T): void } {
  const el = h('div', { class: 'bn-selectors', role: 'radiogroup', 'aria-label': ariaLabel });
  const keys = new Map<T, HTMLButtonElement>();
  let value = initial;
  const paint = () => {
    for (const [v, b] of keys) {
      b.setAttribute('aria-checked', String(v === value));
      b.tabIndex = v === value ? 0 : -1;
    }
  };
  const pick = (v: T, focus = false) => {
    if (focus) keys.get(v)?.focus();
    if (v === value) return;
    value = v;
    paint();
    onChange(v);
  };
  options.forEach((o, i) => {
    const b = h('button', { type: 'button', class: 'bn-selector', role: 'radio', 'aria-label': o.ariaLabel },
      h('span', { class: 'bn-label' }, o.label),
      h('span', { class: 'bn-led', 'aria-hidden': 'true' }),
      h('span', { class: 'bn-capsule', 'aria-hidden': 'true' }));
    b.addEventListener('click', () => pick(o.value));
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      pick(options[(i + d + options.length) % options.length].value, true);
    });
    keys.set(o.value, b);
    el.append(b);
  });
  paint();
  return { el, set: (v) => { value = v; paint(); }, dispose: () => {} };
}

/** A selector param (toggle, e.g. blend mode) as selector keys, with its legend left. */
export function toggleRow(def: ToggleParamDef, store: ParamStore, legend: string): Component {
  const group = selectorGroup(def.options.map((o) => ({ value: o.value, label: o.label.toLowerCase(), ariaLabel: o.label })),
    String(store.get(def.id)), (v) => store.set(def.id, v), def.label);
  const el = h('div', { class: 'bn-toggle-row' }, h('span', { class: 'bn-legend bn-toggle-legend' }, legend), group.el);
  const unwatch = store.watch(def.id, (v) => group.set(String(v)));
  return { el, dispose: unwatch };
}

// ---------------------------------------------------------------- dropdown

/** VFD dropdown (257:1369): black glass, VFD text, filled caret; the list is a VFD menu with LED rows. */
export const vfdDropdownLook = (o: { start?: boolean } = {}): DropdownLook => ({
  button: `bn-dd${o.start ? ' bn-dd-start' : ''}`,
  list: 'bn-dd-list',
  item: 'bn-dd-item',
  caret: CARET,
  buttonText: (it) => (it.num ? `${it.num} ${it.label}` : it.label),
  renderItem: (it) => [
    h('span', { class: 'bn-dd-led', 'aria-hidden': 'true' }),
    h('span', { class: 'bn-dd-text' }, it.num ? `${it.num} ${it.label}` : it.label),
  ],
});

// ---------------------------------------------------------------- values (faders, dials)

interface ValueBinding {
  el: HTMLElement;
  /** Map a value 0..1 onto the visual. */
  paint(t: number): void;
  /** Pointer interaction: return the new 0..1 for a move, given the start state. */
  drag: 'track' | 'vertical';
  /** For 'track': value at a pointer y (client px) and the grab offset. */
  trackAt?(clientY: number, grabbed: boolean): number;
  /** For 'track': is the pointer on the cap (grab keeps the offset). */
  onCap?(target: EventTarget | null): boolean;
}

/**
 * Shared value behaviour (faders and dials): role="slider" with the 0..10 (or real) value text,
 * drag (track drag for faders, vertical drag for dials, touch too; Shift = 5x finer for dials),
 * arrow keys (0.1 on the 0..10 scale; Shift x10), PageUp / PageDown, Home / End, double-click
 * resets. No wheel (M14): the wheel scrolls the panel.
 */
function bindValue(def: NumberParamDef, store: ParamStore, legend: string, b: ValueBinding): () => void {
  const scale = uiScale(def);
  const span = scale.max - scale.min;
  const el = b.el;
  el.setAttribute('role', 'slider');
  el.tabIndex = 0;
  el.setAttribute('aria-label', def.label);
  el.setAttribute('aria-valuemin', String(scale.min));
  el.setAttribute('aria-valuemax', String(scale.max));
  el.setAttribute('data-legend', legend);

  const tOf = (u: number) => Math.min(1, Math.max(0, (u - scale.min) / span));
  const setUi = (u: number) => store.set(def.id, scale.fromUi(Math.min(scale.max, Math.max(scale.min, u))));
  const nudge = (steps: number) => {
    const shown = Math.round(scale.toUi(store.num(def.id)) / scale.step) * scale.step;
    setUi(shown + steps * scale.step);
  };
  el.addEventListener('keydown', (e) => {
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
  let grabbed = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    el.classList.add('is-dragging');
    startY = e.clientY;
    startU = scale.toUi(store.num(def.id));
    if (b.drag === 'track') {
      grabbed = !!b.onCap?.(e.target);
      if (!grabbed) setUi(scale.min + b.trackAt!(e.clientY, false) * span);
      startU = scale.toUi(store.num(def.id));
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (!el.hasPointerCapture(e.pointerId)) return;
    if (b.drag === 'track') {
      const h0 = el.getBoundingClientRect().height;
      const travel = Math.max(1, h0 - 14);
      setUi(startU + ((startY - e.clientY) / travel) * span);
    } else {
      const fine = e.shiftKey ? 0.2 : 1;
      setUi(startU + ((startY - e.clientY) / 200) * span * fine);
    }
  });
  const end = (e: PointerEvent) => {
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove('is-dragging');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => store.set(def.id, store.defaultOf(def.id)));

  return store.watch<number>(def.id, (v) => {
    const u = scale.toUi(v);
    b.paint(tOf(u));
    el.setAttribute('aria-valuenow', String(Math.round(u * 1000) / 1000));
    el.setAttribute('aria-valuetext', scale.text(v));
    el.title = def.display ? `${def.label}: ${formatValue(def, v)}` : def.label;
    (el.closest('.bn-value')?.querySelector('.bn-value-text') as HTMLElement | null)?.replaceChildren(scale.text(v));
  });
}

/**
 * Fader (269:3623): value above, the fader, legend below. Tall 30 x 96 (travel 82) for the
 * particles / plume banks, short 30 x 84 (travel 70) for audio response. Tick scale both sides
 * (majors at the ends and the middle), a black slot, the cap with a white index; dragging
 * shows the slot fill under the cap.
 */
export function fader(def: NumberParamDef, store: ParamStore, legend: string, size: 'tall' | 'short'): Component {
  const H = size === 'tall' ? 96 : 84;
  const travel = H - 14;
  const ticks = h('span', { class: 'bn-ticks', 'aria-hidden': 'true' });
  const step = (H - 12) / 10; // majors at 6, mid, H - 6
  for (let i = 0; i <= 10; i++) {
    const y = 6 + i * step;
    const major = i % 5 === 0;
    for (const side of [0, 1]) {
      const t = h('span', { class: major ? 'bn-tick is-major' : 'bn-tick' });
      t.style.top = `${Math.round(y * 10) / 10}px`;
      t.style.left = side ? '22px' : major ? '2px' : '4px';
      ticks.append(t);
    }
  }
  const cap = h('span', { class: 'bn-cap', 'aria-hidden': 'true' }, h('span', { class: 'bn-fill' }), h('span', { class: 'bn-index' }));
  const control = h('span', { class: `bn-fader is-${size}` }, ticks, h('span', { class: 'bn-slot', 'aria-hidden': 'true' }), cap);
  const el = h('div', { class: `bn-value bn-value-fader is-${size}` },
    h('span', { class: 'bn-value-text', 'aria-hidden': 'true' }), control, h('span', { class: 'bn-legend' }, legend));
  const dispose = bindValue(def, store, legend, {
    el: control, drag: 'track',
    paint: (t) => { const y = `${Math.round((1 - t) * travel * 10) / 10}px`; cap.style.top = y; cap.style.setProperty('--y', y); },
    onCap: (target) => cap.contains(target as Node),
    trackAt: (y) => {
      const r = control.getBoundingClientRect();
      return Math.min(1, Math.max(0, 1 - (y - r.top - 7) / travel));
    },
  });
  return { el, dispose };
}

/**
 * Atelier C2 dial (269:3402): a 25-dot tick ring over 270 degrees (5 larger majors), the knob
 * side and its convex top (radial highlight, rim), a soft specular, and the index that turns
 * in code (-135 to 135 degrees). Legend above, value below. Vertical drag.
 */
export function dial(def: NumberParamDef, store: ParamStore, legend: string): Component {
  const ring = s('svg', { class: 'bn-dial-ticks', width: 56, height: 56, viewBox: '0 0 56 56', 'aria-hidden': 'true' });
  for (let i = 0; i <= 24; i++) {
    const a = ((-135 + i * 11.25) * Math.PI) / 180;
    const major = i % 6 === 0;
    ring.append(s('circle', { class: major ? 'is-major' : '', cx: 28 + 25.5 * Math.sin(a), cy: 28 - 25.5 * Math.cos(a), r: major ? 1.3 : 0.75 }));
  }
  const index = h('span', { class: 'bn-dial-index' }, h('span'));
  const control = h('span', { class: 'bn-dial' }, ring,
    h('span', { class: 'bn-dial-side', 'aria-hidden': 'true' }),
    h('span', { class: 'bn-dial-top', 'aria-hidden': 'true' }),
    h('span', { class: 'bn-dial-spec', 'aria-hidden': 'true' }),
    index);
  const el = h('div', { class: 'bn-value bn-value-dial' },
    h('span', { class: 'bn-legend' }, legend), control, h('span', { class: 'bn-value-text', 'aria-hidden': 'true' }));
  const dispose = bindValue(def, store, legend, {
    el: control, drag: 'vertical',
    paint: (t) => { index.style.transform = `rotate(${-135 + t * 270}deg)`; },
  });
  return { el, dispose };
}

/** Pointer angles of the A1 selector detents, degrees clockwise from up (Figma 31 / 76 / 120 CCW). */
const DETENTS = [-31, -76, -120];

/**
 * Atelier A1 rotary selector (253:1337) for small integer params (Sources 1..3): the title, the
 * positions (dot + number) on the left, the round skirt and the funnel-backed grip bar that
 * turns in code between the detents. Click a number or dot to pick it, click the knob to step,
 * drag around it, arrow keys. ARIA: a slider with "<n> sources" as value text.
 */
export function rotary(def: NumberParamDef, store: ParamStore, legend: string): Component {
  const n = def.max - def.min + 1;
  const knob = h('span', { class: 'bn-knob' });
  const positions: HTMLElement[] = [];
  // Dot and label positions in the 60.44 x 53.35 knob frame (253:1188).
  const DOTS = [[24.44, 4], [10, 22.82], [13.1, 46.35]];
  const LABELS = [[15.44, 0], [0, 18.82], [3.1, 42.35]];
  for (let i = 0; i < Math.min(3, n); i++) {
    const v = def.min + i;
    const p = h('span', { class: 'bn-pos', 'data-v': v, 'aria-hidden': 'true' });
    p.style.left = `${DOTS[i][0]}px`;
    p.style.top = `${DOTS[i][1]}px`;
    const l = h('span', { class: 'bn-pos-label', 'data-v': v, 'aria-hidden': 'true' }, String(v));
    l.style.left = `${LABELS[i][0]}px`;
    l.style.top = `${LABELS[i][1]}px`;
    positions.push(p, l);
  }
  const grip = s('svg', { class: 'bn-grip', width: 48, height: 48, viewBox: '0 0 48 48', 'aria-hidden': 'true' });
  const defs = s('defs', {});
  const gid = nextId('grip');
  const g1 = s('linearGradient', { id: `${gid}-s`, x1: 0, y1: 0, x2: 1, y2: 0 });
  for (const [o, c] of [[0, '#050506'], [0.5, '#141516'], [1, '#030304']]) g1.append(s('stop', { offset: o, 'stop-color': c }));
  const g2 = s('linearGradient', { id: `${gid}-t`, x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [o, c] of [[0, '#4a4d51'], [0.6, '#303235'], [1, '#232527']]) g2.append(s('stop', { offset: o, 'stop-color': c }));
  defs.append(g1, g2);
  grip.append(defs,
    s('path', { class: 'bn-grip-sides', transform: 'translate(15 4)', fill: `url(#${gid}-s)`, stroke: '#000000CC', 'stroke-width': 0.5,
      d: 'M2.77 1.9C2.77.63 3.31 0 4.41 0h9.01c1.09 0 1.64.63 1.64 1.9v23.69c.25 5.69 1.64 9.48 2.87 12.8.22.95-.06 1.48-.82 1.61H1.13c-.93 0-1.29-.6-1.07-1.61 1.07-4.17 2.46-7.11 2.71-12.8z' }),
    s('path', { class: 'bn-grip-top', transform: 'translate(16 5)', fill: `url(#${gid}-t)`,
      d: 'M2.71.79C2.71.26 2.96 0 3.45 0h9.06c.49 0 .74.26.74.79v24.61c.28 5.46 1.57 9.33 2.68 12.5.19.66 0 1.03-.55 1.09H.77C.15 39.06-.09 38.56.03 37.9.96 34.03 2.43 30.86 2.71 25.4z' }),
    s('rect', { class: 'bn-grip-index', x: 23.2, y: 6, width: 1.6, height: 8, rx: 0.8 }));
  const pointer = h('span', { class: 'bn-pointer' });
  pointer.append(grip);
  const skirt = h('span', { class: 'bn-skirt', 'aria-hidden': 'true' });
  knob.append(...positions, skirt, h('span', { class: 'bn-sheen', 'aria-hidden': 'true' }), pointer);
  const el = h('div', { class: 'bn-rotary' }, h('span', { class: 'bn-legend bn-rotary-title' }, legend), knob);
  knob.setAttribute('role', 'slider');
  knob.tabIndex = 0;
  knob.setAttribute('aria-label', def.label);
  knob.setAttribute('aria-valuemin', String(def.min));
  knob.setAttribute('aria-valuemax', String(def.max));

  const set = (v: number) => store.set(def.id, Math.min(def.max, Math.max(def.min, v)));
  knob.addEventListener('keydown', (e) => {
    const v = store.num(def.id);
    const to = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? v + 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? v - 1
      : e.key === 'Home' ? def.min : e.key === 'End' ? def.max : e.key === ' ' || e.key === 'Enter' ? (v >= def.max ? def.min : v + 1) : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    set(to);
  });
  // Click / drag: the detent nearest the pointer's angle around the skirt centre; a click on
  // the skirt itself steps to the next position.
  const centre = () => { const r = skirt.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 }; };
  const nearest = (x: number, y: number) => {
    const c = centre();
    const a = (Math.atan2(x - c.x, -(y - c.y)) * 180) / Math.PI;
    let best = 0;
    DETENTS.forEach((d, i) => { if (Math.abs(a - d) < Math.abs(a - DETENTS[best])) best = i; });
    return def.min + best;
  };
  let moved = false;
  let sx = 0;
  let sy = 0;
  knob.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    knob.focus({ preventScroll: true });
    moved = false;
    sx = e.clientX; sy = e.clientY;
    const lab = (e.target as HTMLElement).closest?.('[data-v]') as HTMLElement | null;
    if (lab) { set(Number(lab.dataset.v)); moved = true; }
  });
  knob.addEventListener('pointermove', (e) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 4) return;
    moved = true;
    set(nearest(e.clientX, e.clientY));
  });
  const end = (e: PointerEvent) => {
    if (!knob.hasPointerCapture(e.pointerId)) return;
    knob.releasePointerCapture(e.pointerId);
    if (!moved && e.type === 'pointerup') { const v = store.num(def.id); set(v >= def.max ? def.min : v + 1); }
  };
  knob.addEventListener('pointerup', end);
  knob.addEventListener('pointercancel', end);

  const unwatch = store.watch<number>(def.id, (v) => {
    const i = Math.round(v) - def.min;
    pointer.style.transform = `rotate(${DETENTS[Math.min(DETENTS.length - 1, Math.max(0, i))]}deg)`;
    knob.setAttribute('aria-valuenow', String(v));
    knob.setAttribute('aria-valuetext', `${v} ${v === 1 ? 'source' : 'sources'}`);
    for (const p of positions) p.classList.toggle('is-on', Number(p.dataset.v) === v);
  });
  return { el, dispose: unwatch };
}

/** Colour swatch (253:1349): a capsule well with the colour inset, legend below; opens the picker. */
export function swatch(def: ColorParamDef, store: ParamStore, legend: string): Component {
  const id = nextId(`p-${def.id}`);
  const picker = h('input', { class: 'bn-swatch-input', type: 'color', id, 'aria-label': def.label });
  const face = h('span', { class: 'bn-swatch-face' });
  picker.addEventListener('input', () => store.set(def.id, picker.value));
  const el = h('div', { class: 'bn-swatch' },
    h('span', { class: 'bn-swatch-well' }, face, picker),
    h('label', { class: 'bn-legend', for: id }, legend));
  const unwatch = store.watch<string>(def.id, (v) => {
    picker.value = v.toLowerCase();
    face.style.backgroundColor = v;
    el.title = `${def.label} ${v.toUpperCase()}`;
  });
  return { el, dispose: unwatch };
}

