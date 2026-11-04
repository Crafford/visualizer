import './themes/te.css';

/**
 * UI chrome themes (panel, keys, transport, floating keys). They never touch the visualizer.
 * A theme has a light and a dark variant; the CSS selects on <html data-theme="<id>-<mode>">.
 * To add a theme: a CSS file defining the same tokens as themes/te.css under
 * [data-theme='<id>-light'] and [data-theme='<id>-dark'], imported here, and one entry below.
 */
export type ThemeMode = 'light' | 'dark';

export interface UiTheme { id: string; label: string; /** Text on the closed dropdown key, when the label is too long. */ short?: string }

export const THEMES: readonly UiTheme[] = [
  { id: 'te', label: 'Teenage Engineering', short: 'Teenage Eng.' },
];

export interface UiPrefs {
  theme: string;
  mode: ThemeMode;
  /** Control panel open. */
  panel: boolean;
}

/**
 * Storage. v2 (M14) stores `mode` only when the user picked LT / DRK; with no stored mode the UI
 * follows the system colour scheme (and keeps following it live). v1 always saved the mode,
 * also when it was only the default, so on the first v2 load the theme and panel state are
 * carried over from v1 and its mode is dropped: every visitor starts on the system scheme once.
 */
const KEY = 'visualizer.ui.v2';
const LEGACY_KEY = 'visualizer.ui.v1';
const DEFAULTS = { theme: THEMES[0].id, panel: true };

const darkQuery = (): MediaQueryList | null => {
  try { return window.matchMedia('(prefers-color-scheme: dark)'); } catch { return null; }
};
export const systemMode = (): ThemeMode => (darkQuery()?.matches ? 'dark' : 'light');

interface Stored { prefs: UiPrefs; /** The user picked the mode (stored); otherwise it follows the system. */ explicit: boolean }

/** Per-viewer UI preferences in localStorage. Every access is guarded (private mode, blocked storage). */
export function loadPrefs(): Stored {
  let p: Partial<UiPrefs> = {};
  let explicit = false;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      p = JSON.parse(raw) as Partial<UiPrefs>;
      explicit = p.mode === 'light' || p.mode === 'dark';
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
      mode: explicit ? p.mode! : systemMode(),
      panel: typeof p.panel === 'boolean' ? p.panel : DEFAULTS.panel,
    },
    explicit,
  };
}

export function savePrefs(p: UiPrefs, explicitMode: boolean): void {
  const out: Partial<UiPrefs> = { theme: p.theme, panel: p.panel };
  if (explicitMode) out.mode = p.mode;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(out));
    window.localStorage.removeItem(LEGACY_KEY);
  } catch { /* blocked or full: session only */ }
}

export function applyTheme(p: Pick<UiPrefs, 'theme' | 'mode'>): void {
  document.documentElement.dataset.theme = `${p.theme}-${p.mode}`;
}

/**
 * Tiny observable around the prefs, so the panel and the floating chrome stay in sync.
 * A `set` with a mode is the user's choice (stored, wins from then on). Until then the mode
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
    this.explicit = s.explicit;
    this.query = darkQuery();
    this.query?.addEventListener?.('change', (e) => {
      if (!this.explicit) this.update({ mode: e.matches ? 'dark' : 'light' });
    });
  }
  get(): Readonly<UiPrefs> { return this.value; }
  /** True when the user picked LT / DRK; false while the mode follows the system. */
  modeChosen(): boolean { return this.explicit; }
  set(patch: Partial<UiPrefs>): void {
    if (patch.mode !== undefined) this.explicit = true;
    this.update(patch);
  }
  private update(patch: Partial<UiPrefs>): void {
    this.value = { ...this.value, ...patch };
    savePrefs(this.value, this.explicit);
    if (patch.theme !== undefined || patch.mode !== undefined) applyTheme(this.value);
    for (const fn of this.fns) fn(this.value);
  }
  watch(fn: (p: Readonly<UiPrefs>) => void): () => void {
    fn(this.value);
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
}
