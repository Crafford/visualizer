// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { ParamStore } from '../../app/store';
import type { AudioEngine } from '../../audio/AudioEngine';
import type { EffectEntry } from '../../effects/types';
import type { PresetBank } from '../../presets/store';
import type { Component } from '../dom';
import type { ListenController } from '../listen';
import type { PrefsStore } from '../themes';

export interface PanelActions {
  screenshot(): void;
  /** Switch the active effect (store, stage); the panel re-renders itself from the store. */
  setEffect(id: string): void;
  /** Hide the panel (it minimises into the show key, which brings it back). */
  hide(): void;
  /** The show key (the minimised panel) was activated; mid-morph this reverses the morph. */
  toggle(): void;
}

/** Everything a skin renders from. Skins only read and write these; they own no app state. */
export interface SkinContext {
  store: ParamStore;
  engine: AudioEngine;
  presets: PresetBank;
  effects: readonly EffectEntry[];
  prefs: PrefsStore;
  listen: ListenController;
  actions: PanelActions;
  /** "0.3" (package.json). */
  version: string;
}

/** A rendered panel. Created on skin switch, disposed on the next one. */
export interface SkinPanel extends Component {
  /** Open or minimise (animated unless `instant`). Hiding also closes the info module. */
  setOpen(open: boolean, instant?: boolean): void;
  /** The header hide button and the show key (focus targets). */
  hideButton: HTMLButtonElement;
  showKey: HTMLButtonElement;
  /** Right edge of the open panel (and info module, when docked), px from the window's left. */
  openRight(): number;
  /** Escape pressed outside a control: close an open overlay (info module). True when handled. */
  escape?(): boolean;
}

export interface Skin {
  id: string;
  /** Name in the UI theme dropdown, lower case; each skin sets its own case. */
  label: string;
  /** Load the skin's web fonts (once). The default skin's fonts are in index.html. */
  loadFonts?(): void;
  createPanel(ctx: SkinContext): SkinPanel;
}
