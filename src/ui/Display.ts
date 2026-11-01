import type { AudioEngine } from '../audio/AudioEngine';
import type { TransportState } from '../audio/types';
import { h, Disposer, type Component } from './dom';

const BINS = 52;
const SEGS = 16;
/** The top three LVL segments are the hot zone (design 84:12308). */
const HOT = 3;
/** Spectrum bar height in px (design 84:11279). */
const BAR_H = 22;
/** A bar above this fraction of full height glows orange (peaking). */
const BAR_HOT = 0.86;

export const formatTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '00:00';
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const SOURCE_TITLE: Record<NonNullable<TransportState['source']>, string> = {
  file: 'FILE', url: 'LINK', mic: 'MIC', capture: 'TAB AUDIO',
};

/** Idle bar heights from the design's NO FILE state: a faint 2-4 px comb. */
const idleHeight = (i: number) => (i % 11 === 0 ? 2 : [4, 3, 4, 3, 4, 3, 3, 4, 3, 4, 2][i % 11]);

export interface DisplayApi extends Component {
  setEffect(label: string): void;
  setPreset(num: string, name: string): void;
}

/**
 * The OLED in the panel header (design 84:11269): effect tag, preset, source title and
 * hint, a live spectrum (52 bars, log-spaced 40 Hz..14 kHz, blue marker every 11th bar,
 * orange when peaking), the LVL segment meter (16 segments, the top 3 hot, peak-hold
 * segment), BPM and the elapsed time in green. Driven by the engine's per-frame 'level' event.
 */
export function createDisplay(engine: AudioEngine): DisplayApi {
  const d = new Disposer();
  const tag = h('span', { class: 'oled-tag' }, 'INK');
  const pNum = h('span', { class: 'oled-dim' }, 'P01');
  const pName = h('span', { class: 'oled-strong' }, 'DEFAULT');
  const title = h('div', { class: 'oled-title' }, 'NO FILE');
  const hint = h('div', { class: 'oled-hint' }, 'DROP MP3 / MP4 ANYWHERE');

  const bars: HTMLSpanElement[] = [];
  const spectrum = h('div', { class: 'oled-spectrum', 'aria-hidden': 'true' });
  for (let i = 0; i < BINS; i++) {
    const b = h('span', { class: i % 11 === 0 ? 'bar is-mark' : 'bar' });
    bars.push(b);
    spectrum.append(b);
  }
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
    spectrum,
    h('div', { class: 'oled-meters' },
      h('span', { class: 'oled-dim' }, 'LVL'), meter, bpm, h('span', { class: 'oled-dim' }, 'BPM'), time),
  );

  // ---- spectrum
  let mapped: Int32Array | null = null;   // per bar: [lo, hi) analyser bins
  let raw: Uint8Array<ArrayBuffer> | null = null;
  const vals = new Float32Array(BINS);
  let idle = true;
  const paintIdle = () => {
    idle = true;
    vals.fill(0);
    bars.forEach((b, i) => {
      b.style.height = `${idleHeight(i)}px`;
      b.classList.add('is-idle');
      b.classList.remove('is-hot');
    });
  };
  const ensureMap = () => {
    const n = engine.spectrumSize;
    const sr = engine.sampleRate;
    if (!n || !sr) return false;
    if (raw && raw.length === n && mapped) return true;
    raw = new Uint8Array(new ArrayBuffer(n));
    mapped = new Int32Array(BINS * 2);
    const hz = (k: number) => 40 * Math.pow(14000 / 40, k / BINS);
    for (let i = 0; i < BINS; i++) {
      const lo = Math.max(1, Math.floor((hz(i) / (sr / 2)) * n));
      const hi = Math.max(lo + 1, Math.floor((hz(i + 1) / (sr / 2)) * n));
      mapped[i * 2] = lo;
      mapped[i * 2 + 1] = Math.min(n, hi);
    }
    return true;
  };
  const paintSpectrum = (playing: boolean) => {
    if (!playing || !ensureMap() || !engine.getSpectrum(raw!)) {
      if (!idle) paintIdle();
      return;
    }
    idle = false;
    for (let i = 0; i < BINS; i++) {
      let peak = 0;
      for (let k = mapped![i * 2]; k < mapped![i * 2 + 1]; k++) peak = Math.max(peak, raw![k]);
      // Gentle tilt so the highs are not always flat, then a fast-attack / slow-release bar.
      const v = Math.min(1, Math.pow(peak / 255, 1.6) * (1 + i / BINS * 0.6));
      vals[i] = v > vals[i] ? v : vals[i] * 0.86 + v * 0.14;
      const b = bars[i];
      b.style.height = `${Math.max(2, Math.round(vals[i] * BAR_H))}px`;
      b.classList.remove('is-idle');
      b.classList.toggle('is-hot', vals[i] > BAR_HOT);
    }
  };

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
    paintSpectrum(st.playing);
    const t = formatTime(st.live ? engine.frameTime : st.currentTime);
    if (t !== lastTime) { time.textContent = t; lastTime = t; }
    const now = performance.now();
    if (now - lastAria > 500) { meter.setAttribute('aria-valuenow', level.toFixed(2)); lastAria = now; }
  }));
  d.add(engine.on('beat', (_s, tempo) => { bpm.textContent = tempo > 0 ? String(tempo) : '---'; }));
  d.add(engine.on('state', (s) => {
    title.textContent = s.source ? SOURCE_TITLE[s.source] : 'NO FILE';
    hint.textContent = s.source ? s.label.toUpperCase() : 'DROP MP3 / MP4 ANYWHERE';
    if (!s.source) {
      bpm.textContent = '---';
      time.textContent = lastTime = '00:00';
      segs.forEach((x) => x.classList.remove('on'));
      lastLit = lastPeak = -1;
    } else if (!s.live) {
      const t = formatTime(s.currentTime);
      if (t !== lastTime) { time.textContent = t; lastTime = t; }
    }
    if (!s.playing) paintIdle();
  }));
  paintIdle();

  return {
    el,
    setEffect: (label) => { tag.textContent = label.toUpperCase(); },
    setPreset: (num, name) => { pNum.textContent = num; pName.textContent = name.toUpperCase(); },
    dispose: () => d.dispose(),
  };
}
