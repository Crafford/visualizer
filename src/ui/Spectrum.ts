// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../audio/AudioEngine';
import { h } from './dom';

const BINS = 52;
/** Spectrum bar height in px (design 84:11279). */
const BAR_H = 22;
/** A bar above this fraction of full height glows orange (peaking). */
const BAR_HOT = 0.86;

/** Idle bar heights from the design's NO FILE state: a faint 2-4 px comb. */
const idleHeight = (i: number) => (i % 11 === 0 ? 2 : [4, 3, 4, 3, 4, 3, 3, 4, 3, 4, 2][i % 11]);

export interface Spectrum {
  el: HTMLElement;
  /** Call once per frame (the engine's 'level' event). Shows the idle comb when not playing. */
  paint(playing: boolean): void;
  idle(): void;
}

/**
 * The OLED spectrum row (design 84:11279): 52 bars, log-spaced 40 Hz..14 kHz from
 * engine.getSpectrum(), a blue marker bar every 11th, orange above 86% (peaking), a
 * fast-attack / slow-release fall, and a faint idle comb when nothing plays. Used by the
 * panel display and by the live transport strip.
 */
export function createSpectrum(engine: AudioEngine, cls = ''): Spectrum {
  const bars: HTMLSpanElement[] = [];
  const el = h('div', { class: `oled-spectrum ${cls}`.trim(), 'aria-hidden': 'true' });
  for (let i = 0; i < BINS; i++) {
    const b = h('span', { class: i % 11 === 0 ? 'bar is-mark' : 'bar' });
    bars.push(b);
    el.append(b);
  }

  let mapped: Int32Array | null = null;   // per bar: [lo, hi) analyser bins
  let raw: Uint8Array<ArrayBuffer> | null = null;
  const vals = new Float32Array(BINS);
  let isIdle = false;

  const idle = () => {
    isIdle = true;
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
  const paint = (playing: boolean) => {
    if (!playing || !ensureMap() || !engine.getSpectrum(raw!)) {
      if (!isIdle) idle();
      return;
    }
    isIdle = false;
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
  idle();
  return { el, paint, idle };
}
