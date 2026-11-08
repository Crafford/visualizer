// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { SOURCE_ERRORS } from '../../../audio/types';
import { h, Disposer, type Component } from '../../dom';
import { createKey } from '../../components/Key';
import { createSlideSwitch } from '../../components/SlideSwitch';
import type { ListenController } from '../../listen';

/**
 * TE input group (Figma TE 84:11369, states 84:11990): SYSTEM [slide switch] MIC, the LISTEN
 * key (latching, LED), and a hint line: what to do for the selected source while idle, the
 * live surface / device in orange while listening, the reason when system audio is not
 * available here or a start failed.
 */
export function createTeInput(listen: ListenController): Component {
  const d = new Disposer();
  const sw = createSlideSwitch({
    cls: 'te-switch', left: 'SYSTEM', right: 'MIC', label: 'Audio source',
    onChange: (k) => listen.select(k),
  });
  d.add(sw.dispose);
  const key = createKey({ label: 'LISTEN', led: true, cls: 'key-listen', tip: 'Start or stop listening (Space)', onClick: () => listen.toggle() });
  key.setAttribute('aria-pressed', 'false');
  const hint = h('p', { class: 'hint input-hint', role: 'status', 'aria-live': 'polite' });

  d.add(listen.watch((v) => {
    sw.set(v.selected, !v.systemSupported);
    key.setAttribute('aria-pressed', String(v.latched));
    let text: string;
    let live = false;
    if (v.error) { text = `× ${SOURCE_ERRORS[v.error]}`; live = true; }
    else if (v.source) { text = `Listening · ${v.label}`; live = true; }
    else if (v.latched) { text = v.selected === 'system' ? 'Waiting for the share dialog' : 'Waiting for the microphone'; }
    else if (!v.systemSupported) text = SOURCE_ERRORS.systemUnsupported;
    else text = v.selected === 'system' ? 'Pick entire screen and switch on share system audio.' : 'Uses the default input. Nothing is recorded.';
    hint.textContent = text;
    hint.classList.toggle('is-live', live);
  }));

  const el = h('div', { class: 'group group-input' },
    h('span', { class: 'group-label', id: 'grp-input' }, 'Input'),
    h('div', { class: 'input-row' }, sw.el, key),
    hint,
  );
  return { el, dispose: () => d.dispose() };
}
