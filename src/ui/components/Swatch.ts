import type { ColorParamDef } from '../../app/params';
import type { ParamStore } from '../../app/store';
import { h, nextId, type Component } from '../dom';

/**
 * Colour key (design 84:11772): a flat swatch key over the native colour picker, the short
 * legend and the hex value below. Clicking (or Enter/Space on focus) opens the picker.
 */
export function createSwatch(def: ColorParamDef, store: ParamStore, legend: string): Component {
  const inputId = nextId(`p-${def.id}`);
  const picker = h('input', { class: 'swatch-input', type: 'color', id: inputId, 'aria-label': def.label });
  const key = h('span', { class: 'swatch-key' }, picker);
  const hex = h('span', { class: 'swatch-hex' });
  picker.addEventListener('input', () => store.set(def.id, picker.value));
  const el = h('div', { class: 'swatch' },
    key,
    h('label', { class: 'swatch-label', for: inputId }, legend),
    hex,
  );
  const unwatch = store.watch<string>(def.id, (v) => {
    picker.value = v.toLowerCase();
    key.style.background = v;
    hex.textContent = v.replace('#', '').toUpperCase();
  });
  return { el, dispose: unwatch };
}
