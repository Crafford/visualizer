// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../../../audio/AudioEngine';
import { SOURCE_ERRORS } from '../../../audio/types';
import { h, Disposer, type Component } from '../../dom';
import { createSpectrum } from '../../Spectrum';
import type { ListenController } from '../../listen';

const SEGS = 16;
/** The top three LVL segments are the hot zone (design 84:12308). */
const HOT = 3;

export interface DisplayApi extends Component {
  setEffect(label: string): void;
  setPreset(num: string, name: string): void;
}

/**
 * The TE OLED (design 84:11269, M15): effect tag and preset; the main row with the source title
 * (SYSTEM AUDIO / MIC) over its state (LISTENING in orange · the shared surface or mic device;
 * an error in orange; idle: empty, or the unsupported reason, dim) and the big BPM readout (--- until a tempo); the
 * spectrum (Spectrum.ts) and the LVL meter. Driven by the engine's per-frame 'level' event.
 */
export function createTeDisplay(engine: AudioEngine, listen: ListenController): DisplayApi {
  const d = new Disposer();
  const tag = h('span', { class: 'oled-tag' }, 'INK');
  const pNum = h('span', { class: 'oled-dim' }, 'P01');
  const pName = h('span', { class: 'oled-strong' }, 'DEFAULT');
  const title = h('div', { class: 'oled-title' }, 'SYSTEM AUDIO');
  const stateOn = h('span', { class: 'oled-on' });
  const stateRest = h('span');
  const state = h('div', { class: 'oled-hint', role: 'status', 'aria-live': 'polite' }, stateOn, stateRest);

  const spectrum = createSpectrum(engine);
  const segs: HTMLSpanElement[] = [];
  const meter = h('div', { class: 'oled-meter', role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0 });
  for (let i = 0; i < SEGS; i++) {
    const s = h('span', { class: i >= SEGS - HOT ? 'seg is-hot' : 'seg' });
    segs.push(s);
    meter.append(s);
  }
  const bpm = h('span', { class: 'oled-bpm', 'aria-label': 'Tempo' }, '---');

  const el = h('div', { class: 'oled', role: 'group', 'aria-label': 'Display' },
    h('div', { class: 'oled-status' }, tag, h('span', { class: 'spacer' }), pNum, pName),
    h('div', { class: 'oled-main' },
      h('div', { class: 'oled-source' }, title, state),
      h('div', { class: 'oled-tempo' }, bpm, h('span', { class: 'oled-dim oled-bpm-legend' }, 'BPM'))),
    spectrum.el,
    h('div', { class: 'oled-meters' }, h('span', { class: 'oled-dim' }, 'LVL'), meter),
  );

  let lastLit = -1;
  let lastPeak = -1;
  let lastAria = 0;
  const clearMeter = () => { segs.forEach((x) => x.classList.remove('on')); lastLit = lastPeak = -1; };
  d.add(engine.on('level', (level, pk) => {
    const lit = Math.round(level * SEGS);
    const peakSeg = pk > 0.02 ? Math.min(SEGS - 1, Math.ceil(pk * SEGS) - 1) : -1;
    if (lit !== lastLit || peakSeg !== lastPeak) {
      segs.forEach((s, i) => s.classList.toggle('on', i < lit || i === peakSeg));
      lastLit = lit;
      lastPeak = peakSeg;
    }
    spectrum.paint(engine.state.playing);
    const now = performance.now();
    if (now - lastAria > 500) { meter.setAttribute('aria-valuenow', level.toFixed(2)); lastAria = now; }
  }));
  const setBpm = (n: number) => { bpm.textContent = n > 0 ? String(n) : '---'; bpm.classList.toggle('is-set', n > 0); };
  d.add(engine.on('beat', (_s, tempo) => setBpm(tempo)));
  d.add(listen.watch((v) => {
    title.textContent = v.selected === 'mic' ? 'MIC' : 'SYSTEM AUDIO';
    if (v.error) { stateOn.textContent = SOURCE_ERRORS[v.error].toUpperCase(); stateRest.textContent = ''; }
    else if (v.source) { stateOn.textContent = 'LISTENING'; stateRest.textContent = ` · ${v.label.toUpperCase()}`; }
    else { stateOn.textContent = ''; stateRest.textContent = v.systemSupported ? '' : SOURCE_ERRORS.systemUnsupported.toUpperCase(); }
    state.title = v.source ? v.label : '';
    if (!v.source) { setBpm(0); clearMeter(); spectrum.idle(); }
  }));
  if (engine.state.playing) setBpm(engine.bpm);

  return {
    el,
    setEffect: (label) => { tag.textContent = label.toUpperCase(); },
    setPreset: (num, name) => { pNum.textContent = num; pName.textContent = name.toUpperCase(); },
    dispose: () => d.dispose(),
  };
}
