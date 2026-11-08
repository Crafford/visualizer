// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h, Disposer, type Component } from './dom';
import { createPanelMorph } from './PanelMorph';

/**
 * The floating panel card every skin renders into (M15 skin system): the card (`.panel`, fixed
 * --edge from the top left), the scrolling contents with the overlay thumb and edge fades, and
 * the minimise morph into the show key (PanelMorph.ts). Skins provide the contents and the
 * header hide button; colours, radii and shadows come from the skin's tokens.
 */
export interface PanelShell extends Component {
  scroller: HTMLElement;
  /** Open or minimise (animated unless `instant`). */
  setOpen(open: boolean, instant?: boolean): void;
  /** The show key (the minimised card). */
  showKey: HTMLButtonElement;
  /** Right edge of the open panel, px from the window's left (also while minimised). */
  openRight(): number;
}

export function createPanelShell(
  skin: string, contents: readonly HTMLElement[], hideIcon: Element, onKey: () => void,
): PanelShell {
  const d = new Disposer();
  const el = h('aside', { class: `panel panel-${skin}`, id: 'panel', 'aria-label': 'Controls' });
  const scroller = h('div', { class: 'panel-scroll' });
  scroller.append(...contents);
  el.append(scroller);
  d.add(installScroll(el, scroller));
  const morph = createPanelMorph(el, scroller, hideIcon, onKey);
  d.add(morph.dispose);
  return {
    el, scroller, dispose: () => d.dispose(),
    setOpen: morph.set, showKey: morph.key,
    openRight: () => el.offsetLeft + morph.openWidth(),
  };
}

/**
 * Run a theme change inside a short whole-page cross-fade (View Transitions) where the
 * browser has it and motion is allowed; gradients and the canvas cannot transition otherwise.
 */
export function crossFade(update: () => void): void {
  if (typeof document.startViewTransition !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update();
    return;
  }
  const t = document.startViewTransition(update);
  // A second change mid-transition skips the first: not an error worth surfacing.
  const quiet = () => {};
  t.ready.catch(quiet);
  t.finished.catch(quiet);
  t.updateCallbackDone.catch(quiet);
}

/**
 * Overlay scroll bar and edge fades for the panel. The native bar is hidden (CSS); a 4 px
 * thumb tracks scrollTop and can be dragged. It shows while the pointer is over the panel
 * (CSS :hover), while dragging, and on touch screens briefly while scrolling. The
 * scroller gets .can-up / .can-down when there is more content above / below, which turns
 * on the soft fade mask at that edge.
 */
function installScroll(panel: HTMLElement, scroller: HTMLElement): () => void {
  const thumb = h('div', { class: 'panel-thumb' });
  const bar = h('div', { class: 'panel-scrollbar', 'aria-hidden': 'true' }, thumb);
  panel.append(bar);
  let scrollingTimer = 0;
  let raf = 0;

  const layout = () => {
    raf = 0;
    const { scrollTop: top, scrollHeight: total, clientHeight: view } = scroller;
    const max = Math.max(0, total - view);
    const needed = max > 1;
    bar.classList.toggle('is-needed', needed);
    scroller.classList.toggle('can-up', needed && top > 1);
    scroller.classList.toggle('can-down', needed && top < max - 1);
    if (!needed) return;
    const track = bar.clientHeight;
    const th = Math.max(24, Math.round(track * view / total));
    thumb.style.height = `${th}px`;
    thumb.style.transform = `translateY(${Math.round((track - th) * (top / max))}px)`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(layout); };

  // Touch screens have no hover: show the thumb while the content moves instead.
  const noHover = matchMedia('(hover: none)');
  const onScroll = () => {
    schedule();
    if (!noHover.matches) return;
    bar.classList.add('is-scrolling');
    clearTimeout(scrollingTimer);
    scrollingTimer = window.setTimeout(() => bar.classList.remove('is-scrolling'), 700);
  };
  scroller.addEventListener('scroll', onScroll, { passive: true });

  // Drag the thumb.
  let grabY = 0;
  let grabTop = 0;
  thumb.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    thumb.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging');
    grabY = e.clientY;
    grabTop = scroller.scrollTop;
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!thumb.hasPointerCapture(e.pointerId)) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const travel = bar.clientHeight - thumb.offsetHeight;
    if (travel > 0) scroller.scrollTop = grabTop + (e.clientY - grabY) * (max / travel);
  });
  const release = (e: PointerEvent) => {
    if (thumb.hasPointerCapture(e.pointerId)) thumb.releasePointerCapture(e.pointerId);
    bar.classList.remove('is-dragging');
  };
  thumb.addEventListener('pointerup', release);
  thumb.addEventListener('pointercancel', release);

  // Content and size changes (effect switch, input panes, window height).
  const ro = new ResizeObserver(schedule);
  ro.observe(scroller);
  const mo = new MutationObserver(schedule);
  mo.observe(scroller, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  for (const c of scroller.children) ro.observe(c);
  schedule();
  return () => {
    ro.disconnect();
    mo.disconnect();
    clearTimeout(scrollingTimer);
    if (raf) cancelAnimationFrame(raf);
    scroller.removeEventListener('scroll', onScroll);
  };
}
