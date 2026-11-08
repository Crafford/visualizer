// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h, svg } from '../../dom';
import { createKey } from '../../components/Key';
import { INFO_ABOUT, INFO_NOTE, INFO_TAGLINE, infoHelp, infoValue, type InfoRow } from '../../info';

/** Info icon (12 px), as Braun's (254:1207). */
export const TE_INFO_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="5.3" stroke="currentColor" stroke-width="1.2"/><rect x="5.4" y="5" width="1.2" height="4" fill="currentColor"/><circle cx="6" cy="3.3" r="0.8" fill="currentColor"/></svg>';

/**
 * The AVZ1 title as the info key, right-aligned in the title row (M17; Figma TE "Title row —
 * info key states" in 290:2): on hover, keyboard focus or while the module is open a recessed well
 * grows left behind the name, the name slides left and the info icon fades in to its right
 * (orange while open), as Braun's AVZ1. The caller puts it in the h1.
 */
export function teInfoKey(): HTMLButtonElement {
  return h('button', { type: 'button', class: 'te-model', 'aria-label': 'About AVZ1' },
    h('span', { class: 'te-model-well', 'aria-hidden': 'true' }),
    h('span', { class: 'panel-title te-model-name' }, 'AVZ1'),
    h('span', { class: 'te-model-icon', 'aria-hidden': 'true' }, svg(TE_INFO_ICON)));
}

const section = (id: string, title: string, ...body: HTMLElement[]) =>
  h('section', { class: 'te-info-sec', 'aria-labelledby': `te-info-${id}` },
    h('h3', { class: 'section-label', id: `te-info-${id}` },
      h('span', { class: 'section-title' }, title), h('span', { class: 'section-rule', 'aria-hidden': 'true' })),
    ...body);

const rows = (list: readonly InfoRow[]) => h('div', { class: 'te-info-list' }, ...list.map((r) =>
  h('div', { class: 'te-info-row' }, h('span', { class: 'te-info-legend' }, r.legend), h('span', { class: 'te-info-value' }, ...infoValue(r.value)))));

/**
 * TE info module markup (Figma TE 290:6 light, 290:148 dark; over canvas 291:101): a TE panel
 * card with INFO and the CLOSE key, an OLED window (INFO tag, version, AVZ1, tagline), about
 * and help as TE sections, upper case by CSS. Behaviour shared with Braun: ui/info.ts.
 */
export function buildTeInfo(version: string, onClose: () => void): { el: HTMLElement; close: HTMLElement } {
  const close = createKey({ label: 'CLOSE', tip: 'Close (Esc)', cls: 'te-info-close', onClick: onClose });
  const el = h('section', { class: 'te-info', role: 'dialog', 'aria-label': 'Info', 'aria-modal': 'false' },
    h('div', { class: 'te-info-head' },
      h('div', { class: 'te-info-title-row' }, h('h2', { class: 'panel-title te-info-title' }, 'INFO'), close),
      h('div', { class: 'oled te-info-oled' },
        h('div', { class: 'oled-status' }, h('span', { class: 'oled-tag' }, 'INFO'), h('span', { class: 'spacer' }),
          h('span', { class: 'oled-dim' }, `V${version}`)),
        h('div', { class: 'te-info-model' },
          h('span', { class: 'te-info-vz' }, 'AVZ1'),
          h('span', { class: 'oled-hint te-info-tag' }, INFO_TAGLINE)))),
    section('about', 'About', rows(INFO_ABOUT), h('p', { class: 'te-info-note' }, INFO_NOTE)),
    section('help', 'Help', rows(infoHelp('dials'))),
  );
  return { el, close };
}
