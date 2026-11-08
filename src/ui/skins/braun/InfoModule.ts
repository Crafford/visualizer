// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h } from '../../dom';
import { INFO_ABOUT, INFO_NOTE, INFO_TAGLINE, infoHelp, infoValue, type InfoRow } from '../../info';
import { actionKey, header } from './controls';

const rows = (list: readonly InfoRow[]) => h('div', { class: 'bn-info-list' }, ...list.map((r) =>
  h('div', { class: 'bn-info-row' }, h('span', { class: 'bn-info-legend' }, r.legend), h('span', { class: 'bn-info-value' }, ...infoValue(r.value)))));

/**
 * Braun info module markup (Figma 230:640, light 230:643 / dark 230:704; over canvas 230:2128):
 * a second case with the title and close key, a VFD window (VZ1 + version, tagline), about
 * (maker, web, x, licence with the source link), the note, and help. Content and behaviour
 * (docking, VZ1 key, close, Escape, hide) are shared: ui/info.ts.
 */
export function buildBraunInfo(version: string, onClose: () => void): { el: HTMLElement; close: HTMLElement } {
  const close = actionKey({ label: 'close', tip: 'Close (Esc)', onClick: onClose });
  const el = h('section', { class: 'bn-info', role: 'dialog', 'aria-label': 'Info', 'aria-modal': 'false' },
    h('div', { class: 'bn-info-head' },
      h('div', { class: 'bn-info-title-row' }, h('h2', { class: 'bn-info-title' }, 'info'), close),
      h('div', { class: 'bn-info-vfd' },
        h('div', { class: 'bn-info-model' }, h('span', { class: 'bn-info-vz' }, 'VZ1'), h('span', { class: 'bn-info-ver' }, `v${version}`)),
        h('div', { class: 'bn-info-tag' }, INFO_TAGLINE))),
    h('div', { class: 'bn-info-sec' },
      header('info-about', 'about'),
      rows(INFO_ABOUT),
      h('p', { class: 'bn-info-note' }, INFO_NOTE)),
    h('div', { class: 'bn-info-sec bn-info-help' },
      header('info-help', 'help'),
      rows(infoHelp('faders'))),
  );
  return { el, close };
}
