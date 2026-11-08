// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { SOURCE_ERRORS } from '../../../audio/types';
import { h, Disposer, type Component } from '../../dom';
import { createKey } from '../../components/Key';
import { createSlideSwitch } from '../../components/SlideSwitch';
import type { ListenController } from '../../listen';

/**
 * TE input group (Figma TE 84:11369, states 84:11990): SYSTEM [slide switch] MIC and the LISTEN
 * key (latching, LED; the panel's primary key since M17: orange, its LED lit white while listening). No hint line (M16): the OLED shows the live surface / device, errors and
 * the unsupported reason.
 */
export function createTeInput(listen: ListenController): Component {
  const d = new Disposer();
  const sw = createSlideSwitch({
    cls: 'te-switch', left: 'SYSTEM', right: 'MIC', label: 'Audio source',
    onChange: (k) => listen.select(k),
  });
  d.add(sw.dispose);
  const key = createKey({ label: 'LISTEN', led: true, primary: true, cls: 'key-listen', tip: 'Start or stop listening (Space)', onClick: () => listen.toggle() });
  key.setAttribute('aria-pressed', 'false');

  d.add(listen.watch((v) => {
    sw.set(v.selected, !v.systemSupported);
    sw.el.title = v.systemSupported ? '' : SOURCE_ERRORS.systemUnsupported;
    key.setAttribute('aria-pressed', String(v.latched));
  }));

  const el = h('div', { class: 'group group-input' },
    h('span', { class: 'group-label', id: 'grp-input' }, 'Input'),
    h('div', { class: 'input-row' }, sw.el, key),
  );
  return { el, dispose: () => d.dispose() };
}
