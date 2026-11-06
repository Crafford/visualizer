// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { AudioEngine, MSG } from '../audio/AudioEngine';
import type { SourceKind } from '../audio/types';
import { h, Disposer, type Component } from './dom';
import { createKey, createKeyGroup, setDisabled, setKeyLabel } from './components/Key';
import { ICONS } from './icons';

type InputTab = 'capture' | 'link' | 'upload' | 'mic';

/** Source order as designed (84:11990): Capture, Link, Upload, Mic. */
const TABS = [
  { value: 'capture', label: 'CAP', ariaLabel: 'Capture tab audio' },
  { value: 'link', label: 'LNK', ariaLabel: 'Link' },
  { value: 'upload', label: 'UPL', ariaLabel: 'Upload file' },
  { value: 'mic', label: 'MIC', ariaLabel: 'Microphone' },
] as const;

const TAB_OF: Record<SourceKind, InputTab> = { capture: 'capture', url: 'link', file: 'upload', mic: 'mic' };

const ACCEPT = '.mp3,.mp4,.m4a,audio/mpeg,audio/mp4,video/mp4';

/**
 * Input group: CAP / LNK / UPL / MIC keys with LEDs, then the selected source's pane
 * (design 84:11990): Capture start/stop + status, Link field + LOAD, Upload choose-file
 * + file name, Mic start/stop + device. Hint and error lines below.
 * Dropping a file anywhere on the window loads it.
 */
export function createInputSection(engine: AudioEngine): Component {
  const d = new Disposer();
  const status = h('p', { class: 'hint status', role: 'status', 'aria-live': 'polite' });
  const say = (msg: string, isError = false) => {
    status.textContent = msg;
    status.classList.toggle('is-error', isError);
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      say('');
      await fn();
    } catch (err) {
      say(err instanceof Error ? err.message : String(err), true);
    }
  };

  // ---- Upload
  const fileInput = h('input', { type: 'file', accept: ACCEPT, class: 'sr-only', tabindex: -1, 'aria-hidden': 'true' });
  const fileName = h('span', { class: 'input-aside' }, 'MP3 · MP4');
  const uploadHint = h('p', { class: 'hint', hidden: true }, 'MP3 · MP4 — or drop a file anywhere.');
  const loadFile = (file: File) => run(async () => {
    await engine.setSource('file', file);
    await engine.play();
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void loadFile(f);
    fileInput.value = '';
  });
  const upload = h('div', { class: 'input-pane' },
    h('div', { class: 'input-row' },
      createKey({ label: 'CHOOSE FILE', icon: ICONS.upload, cls: 'key-wide', onClick: () => fileInput.click() }),
      fileName,
    ),
    uploadHint,
    fileInput,
  );
  d.add(engine.on('state', (s) => {
    const has = s.source === 'file';
    fileName.textContent = has ? s.label : 'MP3 · MP4';
    fileName.title = has ? s.label : '';
    uploadHint.hidden = !has;
  }));

  // Drag and drop onto the whole window
  const onDragOver = (e: DragEvent) => { e.preventDefault(); };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) { select('upload'); void loadFile(f); }
  };
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);
  d.add(() => { window.removeEventListener('dragover', onDragOver); window.removeEventListener('drop', onDrop); });

  // ---- Live sources: Start/Stop key, status inline when on, hint below when off.
  const livePane = (kind: 'mic' | 'capture', o: {
    start: string; stop: string; idle: string; on: (label: string) => string; disabled?: string;
  }) => {
    const live = h('span', { class: 'input-aside is-live', 'aria-live': 'polite' });
    const hint = h('p', { class: 'hint' }, o.disabled ?? o.idle);
    const btn = createKey({
      label: o.start, cls: 'key-wide',
      onClick: () => run(async () => {
        if (engine.state.source === kind) engine.stop();
        else await engine.setSource(kind, undefined);
      }),
    });
    setDisabled(btn, !!o.disabled);
    d.add(engine.on('state', (s) => {
      const active = s.source === kind;
      setKeyLabel(btn, active ? o.stop : o.start);
      btn.setAttribute('aria-pressed', String(active));
      live.textContent = active ? o.on(s.label) : '';
      hint.hidden = active;
    }));
    return h('div', { class: 'input-pane' }, h('div', { class: 'input-row' }, btn, live), hint);
  };

  const mic = livePane('mic', {
    start: 'START MICROPHONE', stop: 'STOP MICROPHONE',
    idle: 'Uses the default input device. Nothing is recorded.',
    on: (label) => label,
  });
  const capture = livePane('capture', {
    start: 'START CAPTURE', stop: 'STOP CAPTURE',
    idle: 'Pick a tab and tick “Share tab audio” in the dialog. Keep that tab playing.',
    on: (label) => `Capturing: ${label}`,
    disabled: AudioEngine.captureSupported ? undefined : `${MSG.captureUnsupported}.`,
  });

  // ---- Link
  const urlField = h('input', {
    class: 'oled-field', type: 'url', placeholder: 'https://example.com/track.mp3', 'aria-label': 'Audio URL', spellcheck: 'false',
  });
  const loadUrl = () => run(async () => {
    await engine.setSource('url', urlField.value.trim());
    await engine.play();
  });
  urlField.addEventListener('keydown', (e) => { if (e.key === 'Enter') void loadUrl(); });
  const link = h('div', { class: 'input-pane' },
    h('div', { class: 'input-row' }, urlField, createKey({ label: 'LOAD', cls: 'key-load', onClick: () => void loadUrl() })),
    h('p', { class: 'hint' }, 'Direct .mp3 / .m4a only. Spotify, YouTube and other streams → use CAP.'),
  );

  const panes: Record<InputTab, HTMLElement> = { capture, link, upload, mic };
  const show = (tab: InputTab) => {
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== tab;
    say('');
  };
  const keys = createKeyGroup<InputTab>(TABS, 'capture', show, 'Audio input', { cls: 'key-row key-row-4' });
  const select = (tab: InputTab) => { keys.set(tab); show(tab); };
  // CAP is selected on load (its idle pane: START CAPTURE + hint). Selecting never starts a
  // source; capture still needs the START CAPTURE click. Not persisted.
  show('capture');
  // A source started elsewhere (drop, preset of another source...) selects its key.
  let lastSource: SourceKind | null = null;
  d.add(engine.on('state', (s) => {
    if (s.source === lastSource) return;
    lastSource = s.source;
    if (s.source) { keys.set(TAB_OF[s.source]); for (const [k, el] of Object.entries(panes)) el.hidden = k !== TAB_OF[s.source]; }
  }));
  d.add(engine.on('error', (e) => say(e.message, true)));

  const el = h('div', { class: 'group group-input' },
    h('span', { class: 'group-label', id: 'grp-input' }, 'Input'),
    keys.el,
    capture, link, upload, mic,
    status,
  );
  keys.el.setAttribute('aria-labelledby', 'grp-input');
  return { el, dispose: () => d.dispose() };
}
