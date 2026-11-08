// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { AudioEngine } from '../audio/AudioEngine';
import { AudioSourceError, type SourceErrorCode, type SourceKind } from '../audio/types';

/**
 * The input model (M15), shared by every skin: a two-position source switch (system / mic)
 * and a latching listen key.
 * - The switch only selects. Listen starts / stops the selected source.
 * - Flipping the switch while listening hands over to the other source.
 * - Cancelling the share dialog stops listening (LED off). A share without audio stops
 *   listening and reports `noAudio`.
 * - Where system audio cannot be captured the switch is locked to mic.
 * The chosen source is remembered per browser (guarded localStorage).
 */
export interface ListenView {
  /** Switch position. */
  selected: SourceKind;
  /** System audio can be captured here; false locks the switch to mic. */
  systemSupported: boolean;
  /** Listen key latched (LED on): starting or listening. */
  latched: boolean;
  /** Live source (null while idle or while the share dialog is open). */
  source: SourceKind | null;
  /** Surface (entire screen, chrome tab, a window title) or mic device label; lower case for system surfaces. */
  label: string;
  /** Last start failure, cleared by the next switch / listen action. Cancelling is not an error. */
  error: SourceErrorCode | null;
}

const KEY = 'visualizer.source.v1';

const loadSource = (): SourceKind | null => {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'system' || v === 'mic' ? v : null;
  } catch { return null; }
};
const saveSource = (k: SourceKind) => { try { window.localStorage.setItem(KEY, k); } catch { /* session only */ } };

export class ListenController {
  private view: ListenView;
  private fns = new Set<(v: Readonly<ListenView>) => void>();
  /** Bumped per request so a stale failure cannot unlatch a newer one. */
  private req = 0;

  constructor(private readonly engine: AudioEngine, supported = AudioEngine.systemSupported) {
    const stored = loadSource();
    this.view = {
      selected: supported ? (stored ?? 'system') : 'mic',
      systemSupported: supported,
      latched: false, source: null, label: '', error: null,
    };
    engine.on('state', (s) => {
      // Ended from outside ("Stop sharing", mic unplugged): unlatch.
      const latched = s.playing ? true : this.pending ? this.view.latched : false;
      this.update({ source: s.source, label: s.label, latched });
    });
  }

  private pending = false;

  get(): Readonly<ListenView> { return this.view; }

  watch(fn: (v: Readonly<ListenView>) => void): () => void {
    fn(this.view);
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  /** Move the switch. While latched, hands over to the new source. */
  select(kind: SourceKind): void {
    if (kind === 'system' && !this.view.systemSupported) return;
    if (kind === this.view.selected) return;
    saveSource(kind);
    this.update({ selected: kind, error: null });
    if (this.view.latched) void this.start();
  }

  /** The listen key (and Space). */
  toggle(): void {
    if (this.view.latched) this.stop();
    else void this.start();
  }

  stop(): void {
    this.req++;
    this.pending = false;
    this.update({ latched: false, error: null });
    this.engine.stop();
  }

  async start(): Promise<void> {
    const id = ++this.req;
    this.pending = true;
    this.update({ latched: true, error: null });
    try {
      await this.engine.listen(this.view.selected);
      if (id !== this.req) return;
      this.pending = false;
      // listen() resolves without a source when a newer request superseded it.
      if (!this.engine.state.playing) this.update({ latched: false });
    } catch (err) {
      if (id !== this.req) return;
      this.pending = false;
      const code = err instanceof AudioSourceError ? err.code : null;
      this.update({ latched: false, error: code === 'cancelled' ? null : (code ?? 'micUnsupported') });
    }
  }

  private update(patch: Partial<ListenView>): void {
    this.view = { ...this.view, ...patch };
    for (const fn of this.fns) fn(this.view);
  }
}
