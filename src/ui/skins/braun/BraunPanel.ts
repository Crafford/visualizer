// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import './braun-tokens.css';
import './braun.css';
import { h, svg, Disposer } from '../../dom';
import { createDropdown } from '../../components/Dropdown';
import { createSlideSwitch } from '../../components/SlideSwitch';
import { createPresetsSection, type PresetKey, type PresetsLook } from '../../PresetsSection';
import { paramSections, type ParamControl, type ParamSection } from '../../model';
import { createPanelShell, crossFade } from '../../shell';
import { THEMES, type ThemeMode } from '../../themes';
import { ICONS } from '../../icons';
import type { ParamStore } from '../../../app/store';
import type { Skin, SkinContext, SkinPanel } from '../types';
import { actionKey, dial, fader, header, INFO_ICON, listenKey, rotary, selectorGroup, swatch, toggleRow, vfdDropdownLook } from './controls';
import { createVfd } from './Vfd';
import { buildBraunInfo } from './InfoModule';
import { attachInfo } from '../../info';

const FONTS = 'https://fonts.googleapis.com/css2?family=Host+Grotesk:wght@400;500&family=Share+Tech+Mono&display=swap';

/** Load Host Grotesk (400, 500 for VZ1) and Share Tech Mono once, only when the skin is used. */
function loadFonts(): void {
  if (document.querySelector('link[data-skin-fonts="braun"]')) return;
  const pre = (href: string, cross: boolean) => {
    if (document.querySelector(`link[rel="preconnect"][href="${href}"]`)) return;
    document.head.append(h('link', { rel: 'preconnect', href, crossorigin: cross ? '' : undefined }));
  };
  pre('https://fonts.googleapis.com', false);
  pre('https://fonts.gstatic.com', true);
  document.head.append(h('link', { rel: 'stylesheet', href: FONTS, 'data-skin-fonts': 'braun' }));
}

/** Section frame (Section / * components 258:1428...): header + body. */
function section(id: string, title: string, ...body: (HTMLElement | null)[]): HTMLElement {
  return h('section', { class: `bn-section bn-section-${id}`, 'aria-labelledby': `bn-h-${id}` }, header(`bn-h-${id}`, title), ...body);
}

/**
 * Braun mapping of the abstract controls (model.ts): rotaries as the A1 selector (row first,
 * right aligned), selectors as capsule keys, values as tall faders in the particles / plume
 * section, short faders in audio response and Atelier dials elsewhere, swatches as capsule wells.
 */
function renderSection(sec: ParamSection, store: ParamStore, d: Disposer): HTMLElement {
  const lower = (c: ParamControl) => c.legend.toLowerCase();
  const body: HTMLElement[] = [];
  const watchVisible = (c: ParamControl, el: HTMLElement) => {
    const vw = c.def.visibleWhen;
    if (vw) d.add(store.watch<number>(vw.id, (n) => { el.hidden = n < vw.min; }));
  };
  const add = (c: { el: HTMLElement; dispose(): void }, ctl: ParamControl) => { d.add(c.dispose); watchVisible(ctl, c.el); return c.el; };

  for (const c of sec.controls) {
    if (c.kind === 'rotary') body.push(h('div', { class: 'bn-rotary-row' }, add(rotary(c.def, store, lower(c)), c)));
  }
  for (const c of sec.controls) {
    if (c.kind === 'selector') body.push(add(toggleRow(c.def, store, lower(c)), c));
  }
  const values = sec.controls.filter((c) => c.kind === 'value');
  if (values.length) {
    const kind = sec.role === 'audio' ? 'short' : sec.num === 1 ? 'tall' : 'dial';
    const cols = kind === 'short' ? values.length : kind === 'tall' ? 4 : values.length % 4 === 0 ? 4 : 3;
    const bank = h('div', { class: `bn-bank is-${kind}` });
    bank.style.setProperty('--cols', String(cols));
    for (const c of values) {
      if (c.kind !== 'value') continue;
      bank.append(add(kind === 'dial' ? dial(c.def, store, lower(c)) : fader(c.def, store, lower(c), kind), c));
    }
    body.push(bank);
  }
  const swatches = sec.controls.filter((c) => c.kind === 'swatch');
  if (swatches.length) {
    const row = h('div', { class: 'bn-swatches' });
    for (const c of swatches) if (c.kind === 'swatch') row.append(add(swatch(c.def, store, lower(c)), c));
    body.push(row);
  }
  return section(sec.id, sec.label.toLowerCase(), ...body);
}

const KEY_LABELS: Record<PresetKey, string> = {
  reset: 'reset', save: 'save', delete: 'delete', export: 'export', import: 'import', cancel: 'cancel', confirmSave: 'save', confirmDelete: 'delete',
};

const braunPresetsLook: PresetsLook = {
  kase: 'lower',
  dropdown: (onChange) => createDropdown('Preset', onChange, 'bn-dropdown', vfdDropdownLook()),
  key: (which, onClick, tip) => actionKey({ label: KEY_LABELS[which], onClick, tip }),
  nameField: (num, input, cursor) => { num.className = 'bn-name-num'; return h('label', { class: 'bn-name' }, num, input, cursor); },
  idle: (k) => [k.save, k.del, k.imp, k.exp],
  saving: (field, save, cancel) => [h('span', { class: 'bn-cell' }, field), save, cancel],
  deleting: (q, yes, cancel) => [h('span', { class: 'bn-cell bn-confirm' }, q), yes, cancel],
  status: () => {
    const el = h('p', { class: 'bn-hint', role: 'status', 'aria-live': 'polite', hidden: true });
    return { el, set: (msg, error) => { el.textContent = msg.toLowerCase(); el.hidden = !msg; el.classList.toggle('is-error', error); } };
  },
  msg: {
    saved: (num, name) => `saved · ${num} ${name}`,
    deleted: (name) => `deleted · ${name}`,
    imported: (n, name) => (n === 1 ? `imported · ${name}` : `imported · ${n} presets`),
    ask: (name) => `delete ${name}?`,
  },
  frame: (p) => section('presets', 'presets',
    h('div', { class: 'bn-row bn-preset-row' }, h('span', { class: 'bn-cell' }, p.dropdown), p.reset),
    p.actions, p.status, p.file),
};

/**
 * The Braun panel (Figma "Braun" 168:3: light 168:5, dark 168:1507; Panel component 258:2624):
 * a square-cornered case with the header (hide-panel icon key, VZ1 model-name info key), the
 * VFD, then input, ui, visualization, presets, the effect's sections, audio response and output.
 */
function createBraunPanel(ctx: SkinContext): SkinPanel {
  const { store, engine, presets, effects, prefs, listen, actions } = ctx;
  const d = new Disposer();

  // ---- header
  const hideBtn = h('button', {
    type: 'button', class: 'bn-icon-key', 'aria-label': 'Hide panel', 'aria-controls': 'panel', 'aria-expanded': 'true',
    'data-tip': 'Hide panel (H)', onclick: () => actions.hide(),
  }, svg(ICONS.sidebar));
  const model = h('button', {
    type: 'button', class: 'bn-model', 'aria-label': 'About VZ1',
  }, h('span', { class: 'bn-model-well', 'aria-hidden': 'true' }), h('span', { class: 'bn-model-name' }, 'VZ1'),
  h('span', { class: 'bn-model-icon', 'aria-hidden': 'true' }, svg(INFO_ICON)));
  const vfd = createVfd(engine, listen);
  d.add(vfd.dispose);
  const head = h('header', { class: 'bn-header' }, h('div', { class: 'bn-title-row' }, hideBtn, model), vfd.el);

  // ---- input: source switch + listen key
  const sw = createSlideSwitch({ cls: 'bn-switch', left: 'system', right: 'mic', label: 'Audio source', onChange: (k) => listen.select(k) });
  d.add(sw.dispose);
  const listenBtn = listenKey(() => listen.toggle());
  d.add(listen.watch((v) => {
    sw.set(v.selected, !v.systemSupported);
    listenBtn.setAttribute('aria-pressed', String(v.latched));
    sw.el.title = v.systemSupported ? '' : 'system audio needs chrome or edge on a computer';
  }));
  const input = section('input', 'input', h('div', { class: 'bn-source-row' },
    h('div', { class: 'bn-switch-wrap' }, h('span', { class: 'bn-label bn-switch-caption', 'aria-hidden': 'true' }, 'source'), sw.el),
    listenBtn));

  // ---- ui: skin dropdown + light / dark
  const skinDd = createDropdown('UI theme', (id) => crossFade(() => prefs.set({ theme: id })), 'bn-dropdown dd-theme', vfdDropdownLook());
  skinDd.setItems(THEMES.map((t) => ({ value: t.id, label: t.label.toLowerCase() })), prefs.get().theme);
  d.add(skinDd.dispose);
  const modeKeys = selectorGroup<ThemeMode>(
    [{ value: 'light', label: 'light', ariaLabel: 'Light' }, { value: 'dark', label: 'dark', ariaLabel: 'Dark' }],
    prefs.get().mode, (m) => crossFade(() => prefs.set({ mode: m })), 'UI brightness');
  d.add(prefs.watch((p) => { skinDd.set(p.theme); modeKeys.set(p.mode); }));
  const ui = section('ui', 'ui', h('div', { class: 'bn-row bn-ui-row' }, h('span', { class: 'bn-cell' }, skinDd.el), modeKeys.el));

  // ---- visualization
  const vis = createDropdown('Visualization', (id) => actions.setEffect(id), 'bn-dropdown', vfdDropdownLook());
  vis.setItems(effects.map((e) => ({ value: e.id, label: e.label.toLowerCase() })), store.effectId);
  d.add(vis.dispose);
  const visSec = section('visualization', 'visualization', vis.el);

  // ---- presets
  const presetSec = createPresetsSection(store, presets, actions.setEffect, (num, name) => vfd.setPreset(num, name), braunPresetsLook);
  d.add(presetSec.dispose);

  // ---- effect sections + audio response, rebuilt per effect
  const host = h('div', { class: 'bn-params' });
  let effectD = new Disposer();
  const renderEffect = () => {
    effectD.dispose();
    effectD = new Disposer();
    const entry = effects.find((e) => e.id === store.effectId)!;
    host.dataset.effect = entry.id;
    host.replaceChildren(...paramSections(entry).map((sec) => renderSection(sec, store, effectD)));
    vis.set(entry.id);
    vfd.setEffect(entry.label);
  };
  renderEffect();
  d.add(store.onEffect(renderEffect));
  d.add(() => effectD.dispose());

  // ---- output: record clip (coming soon) and screenshot, as action keys
  const output = section('output', 'output', h('div', { class: 'bn-row bn-output-row' },
    actionKey({ label: 'record clip', tip: 'Coming soon', disabled: true }),
    actionKey({ label: 'screenshot', tip: 'Save a PNG of the canvas', onClick: actions.screenshot })));

  const shell = createPanelShell('braun', [head, input, ui, visSec, presetSec.el, host, output], hideBtn.firstElementChild!, actions.toggle);
  d.add(shell.dispose);

  // ---- info module, docked right of the panel (shared behaviour: ui/info.ts)
  const info = attachInfo({ panel: shell.el, trigger: model, build: (onClose) => buildBraunInfo(ctx.version, onClose) });
  d.add(info.dispose);

  return {
    el: shell.el,
    dispose: () => d.dispose(),
    setOpen: (open, instant) => { if (!open) info.setOpen(false); shell.setOpen(open, instant); },
    hideButton: hideBtn,
    showKey: shell.showKey,
    openRight: shell.openRight,
    escape: info.escape,
  };
}

export const BRAUN_SKIN: Skin = { id: 'braun', label: 'atelier', loadFonts, createPanel: createBraunPanel };
