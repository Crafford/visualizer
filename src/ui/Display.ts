// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../audio/AudioEngine';
import type { TransportState } from '../audio/types';
import { h, Disposer, type Component } from './dom';
import { createSpectrum } from './Spectrum';

const SEGS = 16;
/** The top three LVL segments are the hot zone (design 84:12308). */
const HOT = 3;

export const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

/** OLED source title. File and link say whether they are playing; the hint carries the name. */
const sourceTitle = (s: Readonly<TransportState>): string => {
  switch (s.source) {
    case 'file': return `FILE UPLOAD ${s.playing ? 'PLAYING' : 'PAUSED'}`;
    case 'url': return `LINK ${s.playing ? 'PLAYING' : 'PAUSED'}`;
    case 'mic': return 'MIC';
    case 'capture': return 'SYSTEM AUDIO';
    default: return 'NO FILE';
  }
};

export interface DisplayApi extends Component {
  setEffect(label: string): void;
  setPreset(num: string, name: string): void;
}

/**
 * The OLED in the panel header (design 84:11269): effect tag, preset, source title
 * (FILE UPLOAD PLAYING / PAUSED, LINK PLAYING / PAUSED, MIC, SYSTEM AUDIO) and hint (file
 * name, link host/name, device, what is captured), the live spectrum (Spectrum.ts), the LVL segment meter (16 segments, the top 3 hot, peak-hold
 * segment), BPM and the elapsed time in green. Driven by the engine's per-frame 'level' event.
 */
export function createDisplay(engine: AudioEngine): DisplayApi {
  const d = new Disposer();
  const tag = h('span', { class: 'oled-tag' }, 'INK');
  const pNum = h('span', { class: 'oled-dim' }, 'P01');
  const pName = h('span', { class: 'oled-strong' }, 'DEFAULT');
  const title = h('div', { class: 'oled-title' }, 'NO FILE');
  const hint = h('div', { class: 'oled-hint' }, 'DROP MP3 / MP4 ANYWHERE');

  const spectrum = createSpectrum(engine);
  const segs: HTMLSpanElement[] = [];
  const meter = h('div', { class: 'oled-meter', role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0 });
  for (let i = 0; i < SEGS; i++) {
    const s = h('span', { class: i >= SEGS - HOT ? 'seg is-hot' : 'seg' });
    segs.push(s);
    meter.append(s);
  }
  const bpm = h('span', { class: 'oled-strong oled-bpm' }, '---');
  const time = h('span', { class: 'oled-time' }, '00:00');

  const el = h('div', { class: 'oled', role: 'group', 'aria-label': 'Display' },
    h('div', { class: 'oled-status' }, tag, h('span', { class: 'spacer' }), pNum, pName),
    h('div', { class: 'oled-source' }, title, hint),
    spectrum.el,
    h('div', { class: 'oled-meters' },
      h('span', { class: 'oled-dim' }, 'LVL'), meter, bpm, h('span', { class: 'oled-dim' }, 'BPM'), time),
  );

  // ---- level meter + time
  let lastLit = -1;
  let lastPeak = -1;
  let lastTime = '';
  let lastAria = 0;
  d.add(engine.on('level', (level, pk) => {
    const lit = Math.round(level * SEGS);
    const peakSeg = pk > 0.02 ? Math.min(SEGS - 1, Math.ceil(pk * SEGS) - 1) : -1;
    if (lit !== lastLit || peakSeg !== lastPeak) {
      segs.forEach((s, i) => s.classList.toggle('on', i < lit || i === peakSeg));
      lastLit = lit;
      lastPeak = peakSeg;
    }
    const st = engine.state;
    spectrum.paint(st.playing);
    const t = formatTime(st.live ? engine.frameTime : st.currentTime);
    if (t !== lastTime) { time.textContent = t; lastTime = t; }
    const now = performance.now();
    if (now - lastAria > 500) { meter.setAttribute('aria-valuenow', level.toFixed(2)); lastAria = now; }
  }));
  d.add(engine.on('beat', (_s, tempo) => { bpm.textContent = tempo > 0 ? String(tempo) : '---'; }));
  d.add(engine.on('state', (s) => {
    // State events also fire on every timeupdate: only touch the text when it changes.
    const tt = sourceTitle(s);
    const ht = s.source ? s.label.toUpperCase() : 'DROP MP3 / MP4 ANYWHERE';
    if (title.textContent !== tt) title.textContent = tt;
    if (hint.textContent !== ht) { hint.textContent = ht; hint.title = s.source ? s.label : ''; }
    if (!s.source) {
      bpm.textContent = '---';
      time.textContent = lastTime = '00:00';
      segs.forEach((x) => x.classList.remove('on'));
      lastLit = lastPeak = -1;
    } else if (!s.live) {
      const t = formatTime(s.currentTime);
      if (t !== lastTime) { time.textContent = t; lastTime = t; }
    }
    if (!s.playing) spectrum.idle();
  }));

  return {
    el,
    setEffect: (label) => { tag.textContent = label.toUpperCase(); },
    setPreset: (num, name) => { pNum.textContent = num; pName.textContent = name.toUpperCase(); },
    dispose: () => d.dispose(),
  };
}
