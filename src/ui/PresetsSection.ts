import type { ParamStore } from '../app/store';
import { defaultPresetId, resolvePreset, type PresetBank } from '../presets/store';
import type { Preset } from '../presets/types';
import { h, Disposer, type Component } from './dom';
import { createKey, setDisabled } from './components/Key';
import { createDropdown } from './components/Dropdown';

type Mode = 'idle' | 'saving' | 'deleting';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset';
/** P01 is the effect's Default, user presets follow in list order. */
export const presetNum = (i: number) => `P${String(i + 1).padStart(2, '0')}`;

/**
 * Presets group (design 84:11396, states 84:11937): dropdown (P01 · DEFAULT, then the active
 * effect's user presets P02...) + RST, then SAVE / DEL and EXP / IMP. SAVE turns the row into
 * an OLED name field with SAVE / CNCL; DEL asks inline. A status line (green LED on success)
 * reports the result. The selection is remembered per effect for the session; importing a
 * preset of another effect switches to that effect. `onLabel` reports the shown preset.
 */
export function createPresetsSection(
  store: ParamStore, bank: PresetBank, switchEffect: (effectId: string) => void,
  onLabel: (num: string, name: string) => void,
): Component {
  const d = new Disposer();
  const defaultId = () => defaultPresetId(store.effectId);
  const chosen = new Map<string, string>();
  let selected = defaultId();
  let mode: Mode = 'idle';

  const dropdown = createDropdown('Preset', (id) => { say(''); choose(id); }, 'dd-preset');
  d.add(dropdown.dispose);
  const statusText = h('span');
  const status = h('p', { class: 'preset-status', role: 'status', 'aria-live': 'polite', hidden: true },
    h('span', { class: 'status-led', 'aria-hidden': 'true' }), statusText);
  const actions = h('div', { class: 'preset-actions' });
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-hidden': 'true', tabindex: -1 });

  const say = (msg: string, error = false) => {
    statusText.textContent = msg;
    status.hidden = !msg;
    status.classList.toggle('is-error', error);
  };
  const current = (): Preset => bank.get(selected) ?? bank.get(defaultId())!;
  const apply = (p: Preset) => store.patch(resolvePreset(p, store.defaultValues));

  const fill = () => {
    const list = bank.list(store.effectId);
    dropdown.setItems(list.map((p, i) => ({ value: p.id, num: presetNum(i), label: p.name.toUpperCase() })), selected);
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

  // ---- naming row: OLED field with the next number, a block cursor (CSS caret), SAVE / CNCL
  const nameNum = h('span', { class: 'oled-dim' });
  const nameInput = h('input', {
    class: 'name-input', type: 'text', maxlength: 60, spellcheck: 'false', autocomplete: 'off',
    'aria-label': 'Preset name', placeholder: 'NAME',
  });
  const nameField = h('label', { class: 'oled-field name-field' }, nameNum, nameInput, h('span', { class: 'name-cursor', 'aria-hidden': 'true' }));
  const commitSave = () => {
    try {
      const p = bank.save(nameInput.value, store.all, store.effectId);
      say(`Saved “${p.name}”`);
      choose(p.id, false);
    } catch (err) {
      say((err as Error).message, true);
      nameInput.focus();
    }
  };
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); setMode('idle'); }
  });

  const key = (label: string, onClick: () => void, tip?: string, cls = 'key-act') => createKey({ label, onClick, tip, cls });

  function setMode(next: Mode): void {
    mode = next;
    actions.dataset.mode = mode;
    const p = current();
    if (mode === 'saving') {
      const list = bank.list(store.effectId);
      const existing = p.builtIn ? -1 : list.findIndex((x) => x.id === p.id);
      nameNum.textContent = presetNum(existing >= 0 ? existing : list.length);
      nameInput.value = p.builtIn ? '' : p.name.toUpperCase();
      actions.replaceChildren(nameField,
        key('SAVE', commitSave, 'Save current values'),
        key('CNCL', () => setMode('idle'), 'Cancel'));
      nameInput.focus();
      nameInput.select();
    } else if (mode === 'deleting') {
      const yes = key('DEL', () => {
        bank.remove(p.id);
        say(`Deleted “${p.name}”`);
        choose(defaultId(), false);
      }, `Delete “${p.name}”`);
      actions.replaceChildren(
        h('span', { class: 'preset-confirm' }, `Delete “${p.name}”?`),
        yes, key('CNCL', () => setMode('idle'), 'Cancel'));
      yes.focus();
    } else {
      const del = key('DEL', () => setMode('deleting'), 'Delete the selected preset');
      setDisabled(del, !!p.builtIn);
      actions.replaceChildren(
        h('span', { class: 'key-pair' },
          key('SAVE', () => { say(''); setMode('saving'); }, 'Save current values'),
          del),
        h('span', { class: 'key-pair' },
          key('EXP', exportPreset, 'Export the preset as JSON'),
          key('IMP', () => file.click(), 'Import presets from JSON')),
      );
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
      say(added.length === 1 ? `Imported “${added[0].name}”` : `Imported ${added.length} presets`);
      if (added[0].effect !== store.effectId) switchEffect(added[0].effect);
      choose(added[0].id);
    } catch (err) {
      say((err as Error).message, true);
    }
  });

  const reset = createKey({
    label: 'RST', cls: 'key-rst', tip: 'Reload the selected preset',
    onClick: () => { say(''); apply(current()); },
  });

  fill();
  setMode('idle');
  d.add(store.onEffect((effectId) => {
    selected = chosen.get(effectId) ?? defaultId();
    fill();
    setMode('idle');
  }));

  const el = h('div', { class: 'group group-presets' },
    h('span', { class: 'group-label' }, 'Presets'),
    h('div', { class: 'preset-row' }, dropdown.el, reset),
    actions, status, file,
  );
  return { el, dispose: () => d.dispose() };
}
