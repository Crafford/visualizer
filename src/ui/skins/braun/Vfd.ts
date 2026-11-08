// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { AudioEngine } from '../../../audio/AudioEngine';
import { SOURCE_ERRORS } from '../../../audio/types';
import { h, Disposer, type Component } from '../../dom';
import type { ListenController } from '../../listen';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Slanted seven-segment digit (269:3296, 20 x 26): the segment outlines from the design's ghost
 * "8", in order a (top), b, c, d (bottom), e, f, g (middle). Unlit segments stay as the faint
 * ghost; lit ones glow.
 */
const SEGMENTS = [
  'M5.45 1.4 7.07 0h7l1.18 1.4-1.63 1.4h-7z',
  'M15.84 2.1 17.01 3.5l-1.17 7.4-1.62 1.4-1.18-1.4 1.17-7.4z',
  'M14 13.7l1.18 1.4L14 22.5l-1.62 1.4-1.18-1.4 1.18-7.4z',
  'M1.77 24.6l1.62-1.4h7l1.18 1.4-1.62 1.4h-7z',
  'M2.8 13.7l1.18 1.4L2.8 22.5l-1.62 1.4L0 22.5l1.18-7.4z',
  'M4.64 2.1 5.81 3.5l-1.17 7.4-1.62 1.4-1.18-1.4 1.17-7.4z',
  'M3.61 13l1.62-1.4h7l1.18 1.4-1.62 1.4h-7z',
];
/** Lit segments per glyph (a..g bits), '-' is the middle bar only, ' ' all off. */
const GLYPHS: Record<string, string> = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '',
};

function digit(): { el: SVGSVGElement; set(ch: string): void } {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('class', 'bn-digit');
  el.setAttribute('width', '20');
  el.setAttribute('height', '26');
  el.setAttribute('viewBox', '0 0 20 26');
  el.setAttribute('aria-hidden', 'true');
  const paths = SEGMENTS.map((d) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('transform', 'translate(0.55 0)');
    el.append(p);
    return p;
  });
  return {
    el,
    set: (ch) => {
      const on = GLYPHS[ch] ?? '';
      paths.forEach((p, i) => p.classList.toggle('on', on.includes('abcdefg'[i])));
    },
  };
}

const CLIP_SEGS = 12;
/** The top three meter segments are the clip zone. */
const CLIP_ZONE = 3;

export interface VfdApi extends Component {
  setEffect(label: string): void;
  setPreset(num: string, name: string): void;
}

/**
 * The Braun VFD (display 270:5193, states 168:892): black smoked window; top left the ink /
 * smoke chip and the preset; the source LEDs (system / mic: the switch position is bright,
 * the LED lights while listening); the big BPM in slanted seven-segment digits with ghost 8s
 * ("---" until a tempo); the status line ("system audio" idle, "listening · mic" live) with the
 * shared surface or mic device below, or an error; the vertical clip meter driven by the level.
 */
export function createVfd(engine: AudioEngine, listen: ListenController): VfdApi {
  const d = new Disposer();
  const tag = h('span', { class: 'bn-vfd-tag' }, 'ink');
  const pNum = h('span', { class: 'bn-vfd-dim' }, 'p01');
  const pName = h('span', { class: 'bn-vfd-bright' }, 'default');
  const ind = (label: string) => {
    const el = h('span', { class: 'bn-ind' }, h('span', { class: 'bn-ind-led' }), h('span', { class: 'bn-ind-label' }, label));
    return el;
  };
  const indSystem = ind('system');
  const indMic = ind('mic');
  const digits = [digit(), digit(), digit()];
  const status = h('span', { class: 'bn-vfd-status' });
  const sub = h('span', { class: 'bn-vfd-sub' });
  const segs: HTMLSpanElement[] = [];
  const meter = h('span', { class: 'bn-clip-segs', role: 'meter', 'aria-label': 'Input level', 'aria-valuemin': 0, 'aria-valuemax': 1, 'aria-valuenow': 0 });
  for (let i = 0; i < CLIP_SEGS; i++) {
    const s = h('span', { class: i < CLIP_ZONE ? 'bn-seg is-clip' : 'bn-seg' });
    segs.push(s);
    meter.append(s);
  }
  const el = h('div', { class: 'bn-vfd', role: 'group', 'aria-label': 'Display' },
    h('div', { class: 'bn-inds', 'aria-label': 'Source' }, indSystem, indMic),
    h('div', { class: 'bn-readout' },
      h('div', { class: 'bn-legends' }, tag, pNum, pName),
      h('div', { class: 'bn-main', 'aria-label': 'Tempo' }, h('span', { class: 'bn-digits' }, ...digits.map((x) => x.el)), h('span', { class: 'bn-vfd-dim bn-bpm' }, 'bpm')),
      h('div', { class: 'bn-status', role: 'status', 'aria-live': 'polite' }, status, sub)),
    h('div', { class: 'bn-clip', 'aria-hidden': 'false' },
      h('span', { class: 'bn-clip-title' }, 'clip'),
      h('span', { class: 'bn-clip-meter' },
        h('span', { class: 'bn-clip-scale', 'aria-hidden': 'true' }, ...['0', '10', '20', '40'].map((t) => h('span', {}, t))),
        meter)),
  );
  const mainEl = el.querySelector('.bn-main') as HTMLElement;

  const setBpm = (n: number) => {
    const t = n > 0 ? String(Math.min(999, Math.round(n))).padStart(3, ' ') : '---';
    digits.forEach((g, i) => g.set(t[i]));
    mainEl.setAttribute('aria-label', n > 0 ? `${Math.round(n)} bpm` : 'no tempo');
  };

  let lastLit = -1;
  let lastPeak = -1;
  let lastAria = 0;
  const clear = () => { segs.forEach((x) => x.classList.remove('on')); lastLit = lastPeak = -1; };
  d.add(engine.on('level', (level, pk) => {
    if (!engine.state.playing) return;
    const lit = Math.round(level * CLIP_SEGS);
    const peak = pk > 0.02 ? Math.min(CLIP_SEGS - 1, Math.ceil(pk * CLIP_SEGS) - 1) : -1;
    if (lit !== lastLit || peak !== lastPeak) {
      // Segment 0 is the top: lit from the bottom up.
      segs.forEach((s, i) => { const k = CLIP_SEGS - 1 - i; s.classList.toggle('on', k < lit || k === peak); });
      lastLit = lit;
      lastPeak = peak;
    }
    const now = performance.now();
    if (now - lastAria > 500) { meter.setAttribute('aria-valuenow', level.toFixed(2)); lastAria = now; }
  }));
  d.add(engine.on('beat', (_s, tempo) => setBpm(tempo)));
  d.add(listen.watch((v) => {
    const name = v.selected === 'mic' ? 'mic' : 'system audio';
    for (const [node, k] of [[indSystem, 'system'], [indMic, 'mic']] as const) {
      node.classList.toggle('is-selected', v.selected === k);
      node.classList.toggle('is-live', v.source === k);
    }
    if (v.error) {
      const [a, ...b] = SOURCE_ERRORS[v.error].split(', ');
      status.textContent = a;
      sub.textContent = b.join(', ');
    } else if (v.source) {
      status.textContent = `listening · ${v.source === 'mic' ? 'mic' : 'system audio'}`;
      sub.textContent = v.label.toLowerCase();
    } else if (!v.systemSupported) {
      status.textContent = name;
      sub.textContent = SOURCE_ERRORS.systemUnsupported;
    } else {
      status.textContent = name;
      sub.textContent = '';
    }
    sub.hidden = !sub.textContent;
    el.classList.toggle('is-error', !!v.error);
    if (!v.source) { setBpm(0); clear(); }
  }));
  if (engine.state.playing) setBpm(engine.bpm);

  return {
    el,
    setEffect: (label) => { tag.textContent = label.toLowerCase(); },
    setPreset: (num, name) => { pNum.textContent = num.toLowerCase(); pName.textContent = name.toLowerCase(); },
    dispose: () => d.dispose(),
  };
}
