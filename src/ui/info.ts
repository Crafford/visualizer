// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { h } from './dom';

/**
 * The info module, shared by every skin (M16): its content (lower case; skins set the case) and
 * its behaviour. A skin builds the markup (`build`) from INFO_* and `infoValue`; `attachInfo`
 * docks it 20 px right of the panel (over it below 760 px, shell.css `.info-module`), wires the
 * info key (toggle, aria-expanded, `is-open`), the close key, Escape (via `escape`) and focus.
 * Hiding the panel closes it (the skin calls `setOpen(false)` from its own `setOpen`).
 */

export const REPO_URL = 'https://github.com/Crafford/visualizer';
export const WEB_URL = 'https://jaco.studio';
export const X_URL = 'https://x.com/jcrafford';

export type InfoPart = string | { href: string; text: string };
export interface InfoRow { legend: string; value: readonly InfoPart[] }

export const INFO_TAGLINE = 'audio-reactive visualiser';

export const INFO_ABOUT: readonly InfoRow[] = [
  { legend: 'made by', value: ['jaco crafford'] },
  { legend: 'web', value: [{ href: WEB_URL, text: 'jaco.studio' }] },
  { legend: 'x', value: [{ href: X_URL, text: 'x.com/jcrafford' }] },
  { legend: 'licence', value: ['agpl-3.0 · source on ', { href: REPO_URL, text: 'github.com/Crafford/visualizer' }] },
];

export const INFO_NOTE = 'made with love, inspired by mid-century appliance design. built with claude opus 5.5, co-designed in figma with claude.';

/** Help rows; `valueControls` names the skin's audio response controls ("faders", "dials"). */
export const infoHelp = (valueControls: string): readonly InfoRow[] => [
  { legend: 'start', value: ['pick a source with the switch (system or mic), then press listen.'] },
  { legend: 'system audio', value: ['in chrome’s dialog, select a window and switch on “share system audio”. needs chrome or edge on a computer.'] },
  { legend: 'mic', value: ['uses the default input. nothing is recorded.'] },
  { legend: 'what moves', value: ['the visuals react to bass, mid, high and beats.'] },
  { legend: 'audio response', value: [`${valueControls} set sensitivity per band, attack and release smoothing, and surge on beats.`] },
  { legend: 'presets', value: ['save and load looks.'] },
  { legend: 'keys', value: ['h hides the panel. space toggles listening. fullscreen key top right. screenshot saves a png.'] },
];

/** A link that opens in a new tab; long paths may break after a slash ("github.com/Crafford/" | "visualizer"). */
export function infoLink(href: string, text: string): HTMLAnchorElement {
  const a = h('a', { href, target: '_blank', rel: 'noopener' });
  text.split('/').forEach((part, i, all) => {
    const last = i === all.length - 1;
    a.append(part + (last ? '' : '/'));
    if (!last) a.append(h('wbr'));
  });
  return a;
}

export const infoValue = (parts: readonly InfoPart[]): (Node | string)[] =>
  parts.map((p) => (typeof p === 'string' ? p : infoLink(p.href, p.text)));

export interface InfoController {
  readonly open: boolean;
  /** Open or close; `focus` moves focus to the close key (open) or back to the info key (close). */
  setOpen(open: boolean, focus?: boolean): void;
  /** Escape outside a control: close when open. True when handled. */
  escape(): boolean;
  dispose(): void;
}

/**
 * Mount a skin's info module next to the panel and wire it. `build(onClose)` returns the module
 * element (a `.info-module` section, id "info-module", hidden) and its close key.
 */
export function attachInfo(o: {
  panel: HTMLElement;
  trigger: HTMLButtonElement;
  build(onClose: () => void): { el: HTMLElement; close: HTMLElement };
}): InfoController {
  let open = false;
  const { el, close } = o.build(() => setOpen(false, true));
  el.classList.add('info-module');
  el.id = 'info-module';
  el.hidden = true;
  o.trigger.setAttribute('aria-controls', 'info-module');
  o.trigger.setAttribute('aria-expanded', 'false');

  let timer = 0;
  function setOpen(next: boolean, focus = false): void {
    if (next !== open) {
      open = next;
      window.clearTimeout(timer);
      o.trigger.setAttribute('aria-expanded', String(next));
      o.trigger.classList.toggle('is-open', next);
      if (next) {
        el.hidden = false;
        void el.offsetWidth;
        el.classList.add('is-open');
      } else {
        el.classList.remove('is-open');
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.hidden = true;
        else timer = window.setTimeout(() => { if (!open) el.hidden = true; }, 180);
      }
    }
    if (focus) (next ? close : o.trigger).focus({ preventScroll: true });
  }
  const onTrigger = () => setOpen(!open, true);
  o.trigger.addEventListener('click', onTrigger);

  // On a skin switch the shell exists: mount now. On the first render the panel is placed
  // after this runs: mount next to it on the next frame.
  const mount = () => { if (!el.isConnected) (document.querySelector('.shell') ?? o.panel.parentElement)?.append(el); };
  if (document.querySelector('.shell')) mount();
  const raf = requestAnimationFrame(mount);

  return {
    get open() { return open; },
    setOpen,
    escape: () => { if (!open) return false; setOpen(false, true); return true; },
    dispose: () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      o.trigger.removeEventListener('click', onTrigger);
      el.remove();
    },
  };
}
