// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h } from '../../dom';
import { actionKey, header } from './controls';

const REPO = 'https://github.com/Crafford/visualizer';
/** Placeholder until Jaco gives the handle. */
const X_URL = 'https://x.com/handle';

export interface InfoModule {
  el: HTMLElement;
  readonly open: boolean;
  setOpen(open: boolean, focus?: boolean): void;
  dispose(): void;
}

const row = (legend: string, ...value: (Node | string)[]) =>
  h('div', { class: 'bn-info-row' }, h('span', { class: 'bn-info-legend' }, legend), h('span', { class: 'bn-info-value' }, ...value));
const link = (href: string, text: string) => {
  // Break long paths after a slash, as in the design ("github.com/Crafford/" | "visualizer").
  const a = h('a', { href, target: '_blank', rel: 'noopener' });
  text.split('/').forEach((part, i, all) => { a.append(part + (i < all.length - 1 ? '/' : '')); if (i < all.length - 1) a.append(h('wbr')); });
  return a;
};

/**
 * Info module (Figma 230:640, light 230:643 / dark 230:704; over canvas 230:2128): a second case
 * docked 20 px right of the panel. Title and close key, a VFD window (VZ1 + version, tagline),
 * about (maker, web, x, licence with the source link), the note, and help. Opened by the VZ1
 * model name key; closed by its close key, Escape, or hiding the panel. `onClose` returns focus.
 */
export function createInfoModule(version: string, onClose: () => void): InfoModule {
  const close = actionKey({ label: 'close', tip: 'Close (Esc)', onClick: () => onClose() });
  const el = h('section', { class: 'bn-info', id: 'info-module', role: 'dialog', 'aria-label': 'Info', 'aria-modal': 'false', hidden: true },
    h('div', { class: 'bn-info-head' },
      h('div', { class: 'bn-info-title-row' }, h('h2', { class: 'bn-info-title' }, 'info'), close),
      h('div', { class: 'bn-info-vfd' },
        h('div', { class: 'bn-info-model' }, h('span', { class: 'bn-info-vz' }, 'VZ1'), h('span', { class: 'bn-info-ver' }, `v${version}`)),
        h('div', { class: 'bn-info-tag' }, 'audio-reactive ink visualiser'))),
    h('div', { class: 'bn-info-sec' },
      header('info-about', 'about'),
      h('div', { class: 'bn-info-list' },
        row('made by', 'jaco crafford'),
        row('web', link('https://jaco.studio', 'jaco.studio')),
        row('x', link(X_URL, 'x.com/handle')),
        row('licence', 'agpl-3.0 · source on ', link(REPO, 'github.com/Crafford/visualizer'))),
      h('p', { class: 'bn-info-note' }, 'made with love and in appreciation of mid-century inspired design. built with claude opus 5.5, co-designed in figma with claude.')),
    h('div', { class: 'bn-info-sec bn-info-help' },
      header('info-help', 'help'),
      h('div', { class: 'bn-info-list' },
        row('start', 'pick a source with the switch (system or mic), then press listen.'),
        row('system audio', 'in chrome’s dialog choose “entire screen” and switch on “share system audio”. needs chrome or edge on a computer.'),
        row('mic', 'uses the default input. nothing is recorded.'),
        row('what moves', 'the visuals react to bass, mid, high and beats.'),
        row('audio response', 'faders set sensitivity per band, attack and release smoothing, and surge on beats.'),
        row('presets', 'save and load looks.'),
        row('keys', 'h hides the panel. space toggles listening. fullscreen key top right. screenshot saves a png.'))),
  );
  let open = false;
  return {
    el,
    get open() { return open; },
    setOpen(next, focus = false) {
      if (next === open) return;
      open = next;
      if (next) {
        el.hidden = false;
        void el.offsetWidth;
        el.classList.add('is-open');
        if (focus) close.focus({ preventScroll: true });
      } else {
        el.classList.remove('is-open');
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) el.hidden = true;
        else window.setTimeout(() => { if (!open) el.hidden = true; }, 180);
      }
    },
    dispose: () => el.remove(),
  };
}
