// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../audio/AudioEngine';
import { h, svg, Disposer, type Component } from './dom';
import { ICONS } from './icons';
import { formatTime } from './Display';
import { createSpectrum } from './Spectrum';

const CELLS = 36;
/** Space kept between the transport and the panel or the window edge, px. */
const GAP = 16;

export interface TransportApi extends Component {
  /** The panel is open: live sources hide, and the plate keeps clear of the panel. */
  setPanelOpen(open: boolean): void;
}

/**
 * Floating transport (design 139:11 / 139:66 file, 140:19 / 140:136 LIVE; --edge from the bottom). Two source families:
 *
 * - File and link: a play/pause key and an OLED strip with the elapsed time, a 36-cell
 *   progress bar with an orange playhead cell (click or drag to seek; arrow keys +-5 s,
 *   Home/End) and the total. Shown whenever a file or link is loaded, panel open or not.
 * - Mic and capture: just the OLED strip with LIVE and the OLED's spectrum bars (a web page
 *   cannot pause another app, so there is no key). Shown only while the panel is hidden,
 *   since the panel's OLED already shows the same.
 *
 * Nothing loaded: hidden. The plate is centred in the window, or in the space right of the
 * open panel when centring would overlap it (`panelEdge` gives the panel's right edge).
 */
export function createTransport(engine: AudioEngine, panelEdge: () => number): TransportApi {
  const d = new Disposer();
  const play = h('button', { type: 'button', class: 'key key-primary t-play', 'aria-label': 'Play' });
  const elapsed = h('span', { class: 't-time' }, '00:00');
  const total = h('span', { class: 't-time t-total' }, '00:00');
  const cells: HTMLSpanElement[] = [];
  const bar = h('div', {
    class: 't-cells', role: 'slider', tabindex: 0, 'aria-label': 'Seek',
    'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0, 'aria-valuetext': '00:00',
  });
  for (let i = 0; i < CELLS; i++) { const c = h('span', { class: 'cell' }); cells.push(c); bar.append(c); }
  const liveWord = h('span', { class: 't-live' }, 'LIVE');
  const spectrum = createSpectrum(engine, 't-spectrum');

  const strip = h('div', { class: 't-strip' });
  const el = h('div', { class: 'transport plate is-hidden', role: 'group', 'aria-label': 'Transport' }, play, strip);
  el.toggleAttribute('inert', true);

  let source: string | null = null;
  let live = false;
  let panelOpen = true;
  let visible = false;
  let seekable = false;
  let duration = 0;
  let scrub: number | null = null;   // fraction while dragging
  let lastHead = -2;

  const paintProgress = (p: number) => {
    const head = Math.min(CELLS - 1, Math.floor(p * CELLS));
    if (head === lastHead) return;
    lastHead = head;
    cells.forEach((c, i) => {
      c.classList.toggle('on', i < head);
      c.classList.toggle('head', i === head && duration > 0);
    });
  };

  // ---- placement
  const layout = () => {
    if (!visible) return;
    const vw = document.documentElement.clientWidth;
    const lo = panelOpen ? panelEdge() + GAP : GAP;
    const hi = vw - GAP;
    el.style.maxWidth = `${Math.max(0, hi - lo)}px`;
    const w = el.offsetWidth;
    // Centred in the window when that keeps clear of the panel, else centred right of it.
    const cx = vw / 2 - w / 2 >= lo ? vw / 2 : (lo + hi) / 2;
    el.style.left = `${Math.round(cx)}px`;
  };
  const ro = new ResizeObserver(layout);
  ro.observe(el);
  window.addEventListener('resize', layout);
  d.add(() => { ro.disconnect(); window.removeEventListener('resize', layout); });

  let placeRaf = 0;
  const syncVisible = () => {
    const show = source !== null && (!live || !panelOpen);
    if (show === visible) return;
    visible = show;
    el.classList.toggle('is-hidden', !show);
    el.toggleAttribute('inert', !show);
    cancelAnimationFrame(placeRaf);
    el.classList.remove('is-placed');
    if (!show) return;
    layout();
    // Position first, then allow the slide (so it never slides in from the default spot).
    placeRaf = requestAnimationFrame(() => { placeRaf = requestAnimationFrame(() => el.classList.add('is-placed')); });
  };

  /** Rebuild the strip for the source family (media keys and seek bar, or LIVE + spectrum). */
  const setFamily = (isLive: boolean) => {
    el.classList.toggle('is-live', isLive);
    play.hidden = isLive;
    if (isLive) strip.replaceChildren(liveWord, spectrum.el);
    else strip.replaceChildren(elapsed, bar, total);
    lastHead = -2;
    spectrum.idle();
  };

  // ---- seek
  const fracAt = (x: number) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!seekable || live || e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.focus({ preventScroll: true });
    scrub = fracAt(e.clientX);
    paintProgress(scrub);
    elapsed.textContent = formatTime(scrub * duration);
  });
  bar.addEventListener('pointermove', (e) => {
    if (scrub === null || !bar.hasPointerCapture(e.pointerId)) return;
    scrub = fracAt(e.clientX);
    paintProgress(scrub);
    elapsed.textContent = formatTime(scrub * duration);
  });
  const endScrub = (e: PointerEvent) => {
    if (scrub === null) return;
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    engine.seek(scrub * duration);
    scrub = null;
  };
  bar.addEventListener('pointerup', endScrub);
  bar.addEventListener('pointercancel', endScrub);
  bar.addEventListener('keydown', (e) => {
    if (!seekable || live) return;
    const t = engine.state.currentTime;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? t + 5
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? t - 5
        : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
    if (to === null) return;
    e.preventDefault();
    engine.seek(to);
  });

  play.addEventListener('click', () => void engine.toggle());

  let lastPlaying: boolean | null = null;
  d.add(engine.on('state', (s) => {
    const showPause = s.playing && !s.live;
    if (showPause !== lastPlaying) {
      lastPlaying = showPause;
      play.replaceChildren(svg(showPause ? ICONS.pause : ICONS.play));
      play.setAttribute('aria-label', showPause ? 'Pause' : 'Play');
    }
    el.classList.toggle('is-playing', s.playing);
    if (s.source !== source || s.live !== live) {
      source = s.source;
      if (s.live !== live) { live = s.live; setFamily(live); }
      syncVisible();
    }
    if (live || !source) return;
    seekable = s.seekable && Number.isFinite(s.duration) && s.duration > 0;
    duration = Number.isFinite(s.duration) ? s.duration : 0;
    bar.classList.toggle('is-seekable', seekable);
    bar.toggleAttribute('aria-disabled', !seekable);
    total.textContent = formatTime(duration);
    bar.setAttribute('aria-valuemax', String(Math.round(duration)));
    if (scrub === null) {
      elapsed.textContent = formatTime(s.currentTime);
      bar.setAttribute('aria-valuenow', String(Math.round(s.currentTime)));
      bar.setAttribute('aria-valuetext', formatTime(s.currentTime));
      paintProgress(duration > 0 ? s.currentTime / duration : 0);
    }
  }));
  // Smooth playhead between timeupdate events; live spectrum while the strip is showing.
  d.add(engine.on('level', () => {
    if (!visible) return;
    if (live) { spectrum.paint(engine.state.playing); return; }
    if (scrub === null && duration > 0 && engine.state.playing) paintProgress(engine.state.currentTime / duration);
  }));

  play.replaceChildren(svg(ICONS.play));
  setFamily(false);
  paintProgress(0);

  return {
    el,
    setPanelOpen: (open) => { panelOpen = open; syncVisible(); layout(); },
    dispose: () => d.dispose(),
  };
}
