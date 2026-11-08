// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
/**
 * UI skins (panel, keys, LIVE strip, floating keys). They never touch the visualizer.
 * A skin has a light and a dark variant; CSS selects on <html data-theme="<id>-<mode>"> and
 * <html data-skin="<id>">. The implementations are registered in skins/index.ts; this list is
 * the data the prefs validate against (and the UI theme dropdown shows, in each skin's case).
 */
export type ThemeMode = 'light' | 'dark';

export interface UiTheme { id: string; /** Dropdown text, lower case (skins set the case). */ label: string }

/** TE stays the default skin (first). */
export const THEMES: readonly UiTheme[] = [
  { id: 'te', label: 'teenage eng.' },
  { id: 'braun', label: 'braun' },
];

export interface UiPrefs {
  theme: string;
  mode: ThemeMode;
  /** Control panel open. */
  panel: boolean;
}

/**
 * Storage. The LT / DRK mode is never stored: every load starts on the system colour scheme.
 * A LT / DRK click holds for the rest of the visit (system changes are then ignored); until
 * then the mode follows the system live. Theme and panel state are stored. v2 files from M14
 * may still hold a `mode`; it is ignored and dropped on the next save. v1 is migrated as before.
 */
const KEY = 'visualizer.ui.v2';
const LEGACY_KEY = 'visualizer.ui.v1';
const DEFAULTS = { theme: THEMES[0].id, panel: true };

const darkQuery = (): MediaQueryList | null => {
  try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; }
};
export const systemMode = (): ThemeMode => (darkQuery()?.matches ? 'dark' : 'light');

interface Stored { prefs: UiPrefs }

/** Per-viewer UI preferences in localStorage. Every access is guarded (private mode, blocked storage). */
export function loadPrefs(): Stored {
  let p: Partial<UiPrefs> = {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      p = JSON.parse(raw) as Partial<UiPrefs>;
    } else {
      // Migrate from v1: keep theme and panel, drop the (possibly never chosen) mode.
      const old = window.localStorage.getItem(LEGACY_KEY);
      if (old) {
        const o = JSON.parse(old) as Partial<UiPrefs>;
        p = { theme: o.theme, panel: o.panel };
      }
    }
  } catch { /* blocked or corrupt: defaults */ }
  return {
    prefs: {
      theme: THEMES.some((t) => t.id === p.theme) ? p.theme! : DEFAULTS.theme,
      mode: systemMode(),
      panel: typeof p.panel === 'boolean' ? p.panel : DEFAULTS.panel,
    },
  };
}

export function savePrefs(p: UiPrefs): void {
  const out: Partial<UiPrefs> = { theme: p.theme, panel: p.panel };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(out));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch { /* blocked or full: session only */ }
}

export function applyTheme(p: Pick<UiPrefs, 'theme' | 'mode'>): void {
  document.documentElement.dataset.theme = `${p.theme}-${p.mode}`;
  document.documentElement.dataset.skin = p.theme;
}

/**
 * Tiny observable around the prefs, so the panel and the floating chrome stay in sync.
 * A `set` with a mode is the user's choice for this visit (not stored). Until then the mode
 * follows the system colour scheme, also when it changes while the page is open.
 */
export class PrefsStore {
  private value: UiPrefs;
  private explicit: boolean;
  /** Kept so the listener lives as long as the store. */
  private query: MediaQueryList | null;
  private fns = new Set<(p: Readonly<UiPrefs>) => void>();
  constructor() {
    const s = loadPrefs();
    this.value = s.prefs;
    this.explicit = false;
    this.query = darkQuery();
    this.query?.addEventListener?.('change', (e) => {
      if (!this.explicit) this.update({ mode: e.matches ? 'dark' : 'light' });
    });
  }
  get(): Readonly<UiPrefs> { return this.value; }
  /** True when the user picked LT / DRK this visit; false while the mode follows the system. */
  modeChosen(): boolean { return this.explicit; }
  set(patch: Partial<UiPrefs>): void {
    if (patch.mode !== undefined) this.explicit = true;
    this.update(patch);
  }
  private update(patch: Partial<UiPrefs>): void {
    this.value = { ...this.value, ...patch };
    savePrefs(this.value);
    if (patch.theme !== undefined || patch.mode !== undefined) applyTheme(this.value);
    for (const fn of this.fns) fn(this.value);
  }
  watch(fn: (p: Readonly<UiPrefs>) => void): () => void {
    fn(this.value);
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}
