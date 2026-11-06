// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h, svg, Disposer, type Component } from '../dom';

export interface KeyOpts {
  label: string;
  onClick?: (e: MouseEvent) => void;
  /** Orange (light) / light grey (dark) key. */
  primary?: boolean;
  /** Status LED in the top-left corner (lit when the key is on: aria-checked/aria-pressed/.is-on). */
  led?: boolean;
  /** Inline SVG markup drawn before the legend. */
  icon?: string;
  /** Tooltip text (TE tooltip, see Tooltip.ts). */
  tip?: string;
  /** Accessible name when it differs from the legend (e.g. "CAP" -> "Capture"). */
  ariaLabel?: string;
  cls?: string;
}

/**
 * A hardware key: bevelled gradient, 30 px, mono legend. States from the design: hover
 * (white wash), pressed (sunk, inner shadow), on (orange legend + LED), disabled (45%).
 * Disabled keys use aria-disabled so they still show their tooltip.
 */
export function createKey(o: KeyOpts): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: ['key', o.primary && 'key-primary', o.cls].filter(Boolean).join(' '),
    'aria-label': o.ariaLabel,
    'data-tip': o.tip,
  });
  if (o.led) b.append(h('span', { class: 'led', 'aria-hidden': 'true' }));
  if (o.icon) b.append(h('span', { class: 'key-icon' }, svg(o.icon)));
  b.append(h('span', { class: 'key-legend' }, o.label));
  b.addEventListener('click', (e) => {
    if (b.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
    o.onClick?.(e);
  });
  return b;
}

export const setKeyLabel = (b: HTMLButtonElement, text: string) => {
  b.querySelector('.key-legend')!.textContent = text;
};

export const setDisabled = (b: HTMLElement, off: boolean) => {
  if (off) b.setAttribute('aria-disabled', 'true');
  else b.removeAttribute('aria-disabled');
};

export interface KeyOption<T extends string> { value: T; label: string; ariaLabel?: string; tip?: string }

/**
 * A row of keys with LEDs acting as a radio group (input source, LT/DRK, Sources, Mode).
 * Arrow keys move and select, roving tabindex. `ledOutside` puts the LED left of the key
 * (Sources in the design).
 */
export function createKeyGroup<T extends string>(
  options: readonly KeyOption<T>[], initial: T, onChange: (v: T) => void,
  ariaLabel: string, o: { cls?: string; keyCls?: string; ledOutside?: boolean } = {},
): Component & { set(v: T): void; keys: Map<T, HTMLButtonElement> } {
  const el = h('div', { class: `key-group ${o.cls ?? ''}`.trim(), role: 'radiogroup', 'aria-label': ariaLabel });
  const keys = new Map<T, HTMLButtonElement>();
  let value = initial;
  const paint = () => {
    for (const [v, b] of keys) {
      const on = v === value;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.closest('.key-slot')?.classList.toggle('is-on', on);
    }
  };
  const pick = (v: T, focus = false) => {
    if (focus) keys.get(v)?.focus();
    if (v === value) return;
    value = v;
    paint();
    onChange(v);
  };
  options.forEach((opt, i) => {
    const b = createKey({
      label: opt.label, led: !o.ledOutside, ariaLabel: opt.ariaLabel, tip: opt.tip, cls: o.keyCls,
      onClick: () => pick(opt.value),
    });
    b.setAttribute('role', 'radio');
    b.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      pick(options[(i + d + options.length) % options.length].value, true);
    });
    keys.set(opt.value, b);
    el.append(o.ledOutside ? h('span', { class: 'key-slot' }, h('span', { class: 'led', 'aria-hidden': 'true' }), b) : b);
  });
  paint();
  const d = new Disposer();
  return { el, keys, set: (v) => { value = v; paint(); }, dispose: () => d.dispose() };
}
