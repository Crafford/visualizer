// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h, svg, nextId, type Component } from '../dom';
import { ICONS } from '../icons';

export interface DropdownItem {
  value: string; label: string;
  /** Grey prefix, e.g. "P01". */ num?: string;
  /** Shorter text for the closed key when the label does not fit (the list shows the label). */ short?: string;
}

export interface DropdownApi extends Component {
  setItems(items: readonly DropdownItem[], value: string): void;
  set(value: string): void;
  readonly value: string;
}

/** Skin hooks: classes and the caret, and per-item extras (Braun list LEDs). */
export interface DropdownLook {
  button?: string;
  list?: string;
  item?: string;
  caret?: string;
  /** Item content; default: number, label, selected dot. */
  renderItem?(it: DropdownItem, selected: boolean): (Node | string)[];
  /** Closed text; default: short ?? "num · label". */
  buttonText?(it: DropdownItem): string;
}

/**
 * Key-styled select (WAI-ARIA select-only combobox): a key with the current item and a
 * chevron; opens an OLED list under it (design 84:11968). The selected item is orange with
 * a dot. Keys: Up/Down/Home/End move, Enter/Space pick, Escape/Tab close, Alt+Down opens.
 */
export function createDropdown(
  ariaLabel: string, onChange: (value: string) => void, cls = '', look: DropdownLook = {},
): DropdownApi {
  const listId = nextId('lb');
  const text = h('span', { class: 'dd-text' });
  const btn = h('button', {
    type: 'button', class: look.button ?? 'key dd-button', role: 'combobox', 'aria-haspopup': 'listbox',
    'aria-expanded': 'false', 'aria-controls': listId, 'aria-label': ariaLabel,
  }, text, h('span', { class: 'dd-chevron' }, svg(look.caret ?? ICONS.chevron)));
  const list = h('ul', { class: look.list ?? 'dd-list', role: 'listbox', id: listId, 'aria-label': ariaLabel, tabindex: -1, hidden: true });
  const el = h('div', { class: `dropdown ${cls}`.trim() }, btn, list);

  let items: readonly DropdownItem[] = [];
  let value = '';
  let active = -1;
  const optId = (i: number) => `${listId}-${i}`;

  const fmt = (it: DropdownItem) => (it.num ? `${it.num} · ${it.label}` : it.label);
  const paintButton = () => {
    const it = items.find((x) => x.value === value);
    text.textContent = it ? (look.buttonText ? look.buttonText(it) : (it.short ?? fmt(it))) : '';
    btn.title = it?.short ? it.label : '';
  };
  const render = () => {
    list.replaceChildren(...items.map((it, i) => {
      const sel = it.value === value;
      return h('li', {
        id: optId(i), role: 'option', 'aria-selected': String(sel),
        class: [look.item ?? 'dd-item', sel && 'is-selected', i === active && 'is-active'].filter(Boolean).join(' '),
        onpointerdown: ((e: PointerEvent) => e.preventDefault()) as EventListener,
        onclick: () => pick(i),
        onpointermove: () => setActive(i),
      },
      ...(look.renderItem ? look.renderItem(it, sel) : [
        it.num ? h('span', { class: 'dd-num' }, it.num) : null,
        h('span', { class: 'dd-label' }, it.label),
        sel ? h('span', { class: 'dd-dot', 'aria-hidden': 'true' }, '●') : null]));
    }));
  };
  const setActive = (i: number) => {
    if (i === active) return;
    active = i;
    for (const [j, li] of [...list.children].entries()) li.classList.toggle('is-active', j === i);
    if (i >= 0) {
      btn.setAttribute('aria-activedescendant', optId(i));
      (list.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    } else btn.removeAttribute('aria-activedescendant');
  };
  const isOpen = () => !list.hidden;
  const open = () => {
    if (isOpen() || !items.length) return;
    active = Math.max(0, items.findIndex((x) => x.value === value));
    render();
    list.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    el.classList.add('is-open');
    setActive(active);
    document.addEventListener('pointerdown', onOutside, true);
  };
  const close = () => {
    if (!isOpen()) return;
    list.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    el.classList.remove('is-open');
    setActive(-1);
    document.removeEventListener('pointerdown', onOutside, true);
  };
  const onOutside = (e: PointerEvent) => { if (!el.contains(e.target as Node)) close(); };
  const pick = (i: number) => {
    const it = items[i];
    close();
    btn.focus();
    if (!it || it.value === value) return;
    value = it.value;
    paintButton();
    onChange(value);
  };

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  btn.addEventListener('keydown', (e) => {
    const n = items.length;
    if (!n) return;
    if (!isOpen()) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); open(); }
      return;
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(Math.min(n - 1, active + 1)); break;
      case 'ArrowUp': e.preventDefault(); if (e.altKey) pick(active); else setActive(Math.max(0, active - 1)); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(n - 1); break;
      case 'Enter': case ' ': e.preventDefault(); pick(active); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(); break;
    }
  });
  btn.addEventListener('blur', () => setTimeout(() => { if (!el.contains(document.activeElement)) close(); }, 0));

  return {
    el,
    get value() { return value; },
    setItems(next, v) { items = next; value = v; paintButton(); if (isOpen()) render(); },
    set(v) { value = v; paintButton(); if (isOpen()) render(); },
    dispose: () => { close(); },
  };
}
