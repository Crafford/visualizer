// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../audio/AudioEngine';
import { h, Disposer, type Component } from './dom';
import { createSpectrum } from './Spectrum';

/** Space kept between the strip and the panel or the window edge, px. */
const GAP = 16;

export interface LiveStripApi extends Component {
  /** The panel is open: the strip hides (the panel display shows the same). */
  setPanelOpen(open: boolean): void;
  /** The open panel's right edge changed (skin switch, info module). */
  relayout(): void;
}

/**
 * The LIVE strip (TE 140:19 / 140:136, Braun 176:77): shown while listening with the panel
 * hidden; a plate around a display strip with LIVE and the spectrum (Spectrum.ts). There is
 * no transport: a page cannot pause another app, and file playback is gone (M15).
 * Placement: centred in the window, or in the space right of the open panel when centring
 * would overlap it (`panelEdge` gives the panel's right edge). Skins style it by tokens.
 */
export function createLiveStrip(engine: AudioEngine, panelEdge: () => number): LiveStripApi {
  const d = new Disposer();
  const spectrum = createSpectrum(engine, 't-spectrum');
  const strip = h('div', { class: 't-strip' }, h('span', { class: 't-live' }, 'LIVE'), spectrum.el);
  const el = h('div', { class: 'transport plate is-live is-hidden', role: 'group', 'aria-label': 'Live input' }, strip);
  el.toggleAttribute('inert', true);

  let listening = false;
  let panelOpen = true;
  let visible = false;

  const layout = () => {
    if (!visible) return;
    const vw = document.documentElement.clientWidth;
    const lo = panelOpen ? panelEdge() + GAP : GAP;
    const hi = vw - GAP;
    el.style.maxWidth = `${Math.max(0, hi - lo)}px`;
    const w = el.offsetWidth;
    const cx = vw / 2 - w / 2 >= lo ? vw / 2 : (lo + hi) / 2;
    el.style.left = `${Math.round(cx)}px`;
  };
  const ro = new ResizeObserver(layout);
  ro.observe(el);
  window.addEventListener('resize', layout);
  d.add(() => { ro.disconnect(); window.removeEventListener('resize', layout); });

  let placeRaf = 0;
  const syncVisible = () => {
    const show = listening && !panelOpen;
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

  d.add(engine.on('state', (s) => {
    if (s.playing === listening) return;
    listening = s.playing;
    if (!listening) spectrum.idle();
    syncVisible();
  }));
  d.add(engine.on('level', () => { if (visible) spectrum.paint(engine.state.playing); }));

  return {
    el,
    setPanelOpen: (open) => { panelOpen = open; syncVisible(); layout(); },
    relayout: layout,
    dispose: () => d.dispose(),
  };
}
