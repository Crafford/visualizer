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
 * Input (M16): click a legend to select its side; click anywhere on the body to toggle; drag the
 * thumb (it follows the pointer, mouse or touch, and snaps to the nearer end on release); arrow
 * keys, Space / Enter flip. ARIA: a two-step slider whose value text names the source.
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

  // Pointer (mouse, pen, touch): a press without travel toggles; a drag moves the thumb live
  // and snaps to the nearer end on release. State is kept here, not read from pointer capture
  // (capture can be refused or lost; then the drag still ends cleanly).
  let drag: { id: number; x: number; from: number; t: number; moved: boolean } | null = null;
  const travel = () => Math.max(1, body.clientWidth - thumb.offsetWidth);
  body.addEventListener('pointerdown', (e) => {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { body.setPointerCapture(e.pointerId); } catch { /* still works within the body */ }
    body.focus({ preventScroll: true });
    const from = kind === 'mic' ? 1 : 0;
    drag = { id: e.pointerId, x: e.clientX, from, t: from, moved: false };
    el.classList.add('is-dragging');
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 3) return;
    drag.moved = true;
    drag.t = Math.min(1, Math.max(locked ? 1 : 0, drag.from + dx / travel()));
    thumb.style.setProperty('--drag', String(drag.t));
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const g = drag;
    drag = null;
    if (body.hasPointerCapture(e.pointerId)) body.releasePointerCapture(e.pointerId);
    el.classList.remove('is-dragging');
    if (e.type === 'pointercancel') { paint(); return; }
    if (g.moved) pick(g.t >= 0.5 ? 'mic' : 'system');
    else pick(kind === 'mic' ? 'system' : 'mic');
    paint();
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
  body.addEventListener('lostpointercapture', (e) => end(new PointerEvent('pointerup', { pointerId: e.pointerId, clientX: e.clientX })));

  paint();
  return {
    el,
    set: (k, lock) => { kind = k; locked = lock; paint(); },
    dispose: () => d.dispose(),
  };
}
