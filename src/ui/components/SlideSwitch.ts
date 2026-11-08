// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { SourceKind } from '../../audio/types';
import { h, Disposer, type Component } from '../dom';

export interface SlideSwitchApi extends Component {
  /** Position, and whether the system end is locked (the switch then stays on mic). */
  set(kind: SourceKind, systemLocked: boolean): void;
}

/**
 * Two-position source slide switch (system | mic), shared by the skins; each skin styles it
 * (`cls`). It only selects: listening is the listen key's job.
 *
 * Input: click a legend or the far side of the body, drag the thumb (snaps to the nearer end),
 * arrow keys, Space / Enter flip. ARIA: a two-step slider whose value text names the source.
 * The system end can be locked (dimmed, the thumb stays on mic).
 */
export function createSlideSwitch(o: {
  cls: string; left: string; right: string; label: string; onChange(kind: SourceKind): void;
  /** Extra markup inside the thumb (ridges, grips). */
  ridges?: number;
}): SlideSwitchApi {
  const d = new Disposer();
  const thumb = h('span', { class: 'sw-thumb' });
  for (let i = 0; i < (o.ridges ?? 3); i++) thumb.append(h('span', { class: 'sw-ridge' }));
  const body = h('span', {
    class: 'sw-body', role: 'slider', tabindex: 0, 'aria-label': o.label,
    'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0, 'aria-orientation': 'horizontal',
  }, h('span', { class: 'sw-slot' }), h('span', { class: 'sw-glass' }), thumb);
  const left = h('span', { class: 'sw-legend sw-left' }, o.left);
  const right = h('span', { class: 'sw-legend sw-right' }, o.right);
  const el = h('div', { class: `sw ${o.cls}` }, left, body, right);

  let kind: SourceKind = 'system';
  let locked = false;
  const paint = () => {
    el.dataset.pos = kind;
    el.classList.toggle('is-locked', locked);
    body.setAttribute('aria-valuenow', kind === 'mic' ? '1' : '0');
    body.setAttribute('aria-valuetext', kind === 'mic' ? 'mic' : 'system audio');
    left.setAttribute('aria-disabled', String(locked));
    thumb.style.removeProperty('--drag');
  };
  const pick = (k: SourceKind) => {
    if (k === 'system' && locked) { paint(); return; }
    if (k === kind) { paint(); return; }
    o.onChange(k);
  };

  left.addEventListener('click', () => pick('system'));
  right.addEventListener('click', () => pick('mic'));
  body.addEventListener('keydown', (e) => {
    let to: SourceKind | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === 'Home') to = 'system';
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'End') to = 'mic';
    else if (e.key === ' ' || e.key === 'Enter') to = kind === 'mic' ? 'system' : 'mic';
    if (!to) return;
    e.preventDefault();
    e.stopPropagation();
    pick(to);
  });

  // Drag the thumb; a click without movement flips to the side clicked.
  let startX = 0;
  let moved = false;
  body.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    body.setPointerCapture(e.pointerId);
    body.focus({ preventScroll: true });
    startX = e.clientX;
    moved = false;
    el.classList.add('is-dragging');
  });
  body.addEventListener('pointermove', (e) => {
    if (!body.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 2) moved = true;
    const travel = body.clientWidth - thumb.offsetWidth;
    const from = kind === 'mic' ? 1 : 0;
    const t = Math.min(1, Math.max(locked ? 1 : 0, from + dx / Math.max(1, travel)));
    thumb.style.setProperty('--drag', String(t));
  });
  const end = (e: PointerEvent) => {
    if (!body.hasPointerCapture(e.pointerId)) return;
    body.releasePointerCapture(e.pointerId);
    el.classList.remove('is-dragging');
    if (e.type === 'pointercancel') { paint(); return; }
    if (moved) {
      const t = Number(thumb.style.getPropertyValue('--drag') || (kind === 'mic' ? 1 : 0));
      pick(t >= 0.5 ? 'mic' : 'system');
    } else {
      const r = body.getBoundingClientRect();
      pick(e.clientX - r.left >= r.width / 2 ? 'mic' : 'system');
    }
    paint();
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);

  paint();
  return {
    el,
    set: (k, lock) => { kind = k; locked = lock; paint(); },
    dispose: () => d.dispose(),
  };
}
