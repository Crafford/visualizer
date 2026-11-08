// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { ParamStore } from '../app/store';
import { defaultPresetId, resolvePreset, type PresetBank } from '../presets/store';
import type { Preset } from '../presets/types';
import { h, Disposer, type Component } from './dom';
import { setDisabled } from './components/Key';
import type { DropdownApi } from './components/Dropdown';

type Mode = 'idle' | 'saving' | 'deleting';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
/** P01 is the effect's Default, user presets follow in list order. */
export const presetNum = (i: number) => `P${String(i + 1).padStart(2, '0')}`;

/** The selected preset per effect, for the session; module level so it survives a skin switch. */
const chosen = new Map<string, string>();

export type PresetKey = 'reset' | 'save' | 'delete' | 'export' | 'import' | 'cancel' | 'confirmSave' | 'confirmDelete';

/** How a skin draws the presets group. The behaviour (below) is shared. */
export interface PresetsLook {
  /** Text case of names and numbers in the dropdown and the name field. */
  kase: 'upper' | 'lower';
  dropdown(onChange: (id: string) => void): DropdownApi;
  /** An action key (software: momentary command). */
  key(which: PresetKey, onClick: () => void, tip: string): HTMLButtonElement;
  /** Wrap the naming field parts (number, input, block cursor) in the skin's field. */
  nameField(num: HTMLElement, input: HTMLInputElement, cursor: HTMLElement): HTMLElement;
  /** Children of the actions row per mode. */
  idle(k: { save: HTMLButtonElement; del: HTMLButtonElement; exp: HTMLButtonElement; imp: HTMLButtonElement }): HTMLElement[];
  saving(field: HTMLElement, save: HTMLButtonElement, cancel: HTMLButtonElement): HTMLElement[];
  deleting(question: string, yes: HTMLButtonElement, cancel: HTMLButtonElement): HTMLElement[];
  /** The status line or window. */
  status(): { el: HTMLElement; set(msg: string, error: boolean): void };
  /** Result messages. */
  msg: { saved(num: string, name: string): string; deleted(name: string): string; imported(n: number, name: string): string; ask(name: string): string };
  /** Assemble the group. */
  frame(parts: { dropdown: HTMLElement; reset: HTMLButtonElement; actions: HTMLElement; status: HTMLElement; file: HTMLElement }): HTMLElement;
}

/**
 * Presets group (TE 84:11396 / 84:11937, Braun 168:799): dropdown (P01 Default, then the active
 * effect's user presets P02...) + reset, then save / delete / export / import. Save turns the
 * row into a name field with save / cancel; delete asks inline. A status reports the result.
 * The selection is remembered per effect for the session; importing a preset of another effect
 * switches to that effect. `onLabel` reports the shown preset (for the display).
 */
export function createPresetsSection(
  store: ParamStore, bank: PresetBank, switchEffect: (effectId: string) => void,
  onLabel: (num: string, name: string) => void, look: PresetsLook,
): Component {
  const d = new Disposer();
  const kase = (s: string) => (look.kase === 'upper' ? s.toUpperCase() : s.toLowerCase());
  const defaultId = () => defaultPresetId(store.effectId);
  let selected = chosen.get(store.effectId) ?? defaultId();

  const dropdown = look.dropdown((id) => { say(''); choose(id); });
  d.add(dropdown.dispose);
  const status = look.status();
  const actions = h('div', { class: 'preset-actions' });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: -1 });

  const say = (msg: string, error = false) => status.set(msg, error);
  const current = (): Preset => bank.get(selected) ?? bank.get(defaultId())!;
  const apply = (p: Preset) => store.patch(resolvePreset(p, store.defaultValues));
  const numOf = (p: Preset) => {
    const list = bank.list(store.effectId);
    return presetNum(Math.max(0, list.findIndex((x) => x.id === p.id)));
  };

  const fill = () => {
    const list = bank.list(store.effectId);
    dropdown.setItems(list.map((p, i) => ({ value: p.id, num: kase(presetNum(i)), label: kase(p.name) })), selected);
    const i = Math.max(0, list.findIndex((p) => p.id === selected));
    onLabel(presetNum(i), list[i]?.name ?? 'Default');
  };

  const choose = (id: string, load = true) => {
    const p = bank.get(id);
    selected = p && p.effect === store.effectId ? id : defaultId();
    chosen.set(store.effectId, selected);
    fill();
    if (load) apply(current());
    setMode('idle');
  };

  // ---- naming: the next number, the input, a block / bar cursor (CSS)
  const nameNum = h('span', { class: 'name-num' });
  const nameInput = h('input', {
    class: 'name-input', type: 'text', maxlength: 60, spellcheck: 'false', autocomplete: 'off',
    'aria-label': 'Preset name', placeholder: kase('name'),
  });
  const nameField = look.nameField(nameNum, nameInput, h('span', { class: 'name-cursor', 'aria-hidden': 'true' }));
  const commitSave = () => {
    try {
      const p = bank.save(nameInput.value, store.all, store.effectId);
      choose(p.id, false);
      say(look.msg.saved(kase(numOf(p)), kase(p.name)));
    } catch (err) {
      say((err as Error).message, true);
      nameInput.focus();
    }
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMode('idle'); }
  });

  function setMode(mode: Mode): void {
    actions.dataset.mode = mode;
    const p = current();
    const cancel = () => look.key('cancel', () => setMode('idle'), 'Cancel');
    if (mode === 'saving') {
      const list = bank.list(store.effectId);
      const existing = p.builtIn ? -1 : list.findIndex((x) => x.id === p.id);
      nameNum.textContent = kase(presetNum(existing >= 0 ? existing : list.length));
      nameInput.value = p.builtIn ? '' : kase(p.name);
      actions.replaceChildren(...look.saving(nameField, look.key('confirmSave', commitSave, 'Save current values'), cancel()));
      nameInput.focus();
      nameInput.select();
    } else if (mode === 'deleting') {
      const yes = look.key('confirmDelete', () => {
        bank.remove(p.id);
        choose(defaultId(), false);
        say(look.msg.deleted(kase(p.name)));
      }, `Delete “${p.name}”`);
      actions.replaceChildren(...look.deleting(look.msg.ask(kase(p.name)), yes, cancel()));
      yes.focus();
    } else {
      const del = look.key('delete', () => setMode('deleting'), 'Delete the selected preset');
      setDisabled(del, !!p.builtIn);
      actions.replaceChildren(...look.idle({
        save: look.key('save', () => { say(''); setMode('saving'); }, 'Save current values'),
        del,
        exp: look.key('export', exportPreset, 'Export the preset as JSON'),
        imp: look.key('import', () => file.click(), 'Import presets from JSON'),
      }));
    }
  }

  function exportPreset(): void {
    const p = current();
    const blob = new Blob([JSON.stringify(bank.toFile(p), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `preset-${slug(p.name)}.json` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    try {
      const added = bank.importFile(await f.text());
      if (added[0].effect !== store.effectId) switchEffect(added[0].effect);
      choose(added[0].id);
      say(look.msg.imported(added.length, kase(added[0].name)));
    } catch (err) {
      say((err as Error).message, true);
    }
  });

  const reset = look.key('reset', () => { say(''); apply(current()); }, 'Reload the selected preset');

  fill();
  setMode('idle');
  d.add(store.onEffect((effectId) => {
    selected = chosen.get(effectId) ?? defaultId();
    fill();
    setMode('idle');
  }));

  const el = look.frame({ dropdown: dropdown.el, reset, actions, status: status.el, file });
  return { el, dispose: () => d.dispose() };
}
