// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { ColorParamDef } from '../../app/params';
import type { ParamStore } from '../../app/store';
import { h, nextId, type Component } from '../dom';

/**
 * Colour key (design 84:11772): a flat swatch key over the native colour picker and the short
 * legend (M16: no hex line; the hex is the key's tooltip). Clicking (or Enter/Space on focus)
 * opens the picker.
 */
export function createSwatch(def: ColorParamDef, store: ParamStore, legend: string): Component {
  const inputId = nextId(`p-${def.id}`);
  const picker = h('input', { class: 'swatch-input', type: 'color', id: inputId, 'aria-label': def.label });
  const key = h('span', { class: 'swatch-key' }, picker);
  picker.addEventListener('input', () => store.set(def.id, picker.value));
  const el = h('div', { class: 'swatch' },
    key,
    h('label', { class: 'swatch-label', for: inputId }, legend),
  );
  const unwatch = store.watch<string>(def.id, (v) => {
    picker.value = v.toLowerCase();
    key.style.background = v;
    key.dataset.tip = v.toUpperCase();
  });
  return { el, dispose: unwatch };
}
