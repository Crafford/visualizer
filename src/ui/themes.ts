import './themes/te.css';

/**
 * UI chrome themes (panel, keys, transport, floating keys). They never touch the visualizer.
 * A theme has a light and a dark variant; the CSS selects on <html data-theme="<id>-<mode>">.
 * To add a theme: a CSS file defining the same tokens as themes/te.css under
 * [data-theme='<id>-light'] and [data-theme='<id>-dark'], imported here, and one entry below.
 */
export type ThemeMode = 'light' | 'dark';

export interface UiTheme { id: string; label: string }

export const THEMES: readonly UiTheme[] = [
  { id: 'te', label: 'Teenage Engineering' },
];

export interface UiPrefs {
  theme: string;
  mode: ThemeMode;
  /** Control panel open. */
  panel: boolean;
}

const KEY = 'visualizer.ui.v1';
const DEFAULTS: UiPrefs = { theme: THEMES[0].id, mode: 'light', panel: true };

/** Per-viewer UI preferences in localStorage. Every access is guarded (private mode, blocked storage). */
export function loadPrefs(): UiPrefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      theme: THEMES.some((t) => t.id === p.theme) ? p.theme! : DEFAULTS.theme,
      mode: p.mode === 'dark' ? 'dark' : 'light',
      panel: typeof p.panel === 'boolean' ? p.panel : DEFAULTS.panel,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: UiPrefs): void {
  try { window.localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* blocked or full: session only */ }
}

export function applyTheme(p: Pick<UiPrefs, 'theme' | 'mode'>): void {
  document.documentElement.dataset.theme = `${p.theme}-${p.mode}`;
}

/** Tiny observable around the prefs, so the panel and the floating chrome stay in sync. */
export class PrefsStore {
  private value: UiPrefs = loadPrefs();
  private fns = new Set<(p: Readonly<UiPrefs>) => void>();
  get(): Readonly<UiPrefs> { return this.value; }
  set(patch: Partial<UiPrefs>): void {
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
