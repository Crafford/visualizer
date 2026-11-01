import type { AudioEngine } from '../audio/AudioEngine';
import { h, svg, Disposer, type Component } from './dom';
import { ICONS } from './icons';
import { formatTime } from './Display';

const CELLS = 36;

/**
 * Floating transport (design 84:18486, without the VOL encoder): a play/pause key and an
 * OLED strip with a status triangle, the elapsed time, a 36-cell progress bar with an orange
 * playhead cell (click or drag to seek; arrow keys +-5 s, Home/End) and the total time.
 * Live sources (mic, capture) show LIVE and the cells become a level bar.
 */
export function createTransport(engine: AudioEngine): Component {
  const d = new Disposer();
  const play = h('button', { type: 'button', class: 'key key-primary t-play', 'aria-label': 'Play' });
  const state = h('span', { class: 't-state', 'aria-hidden': 'true' }, '▶');
  const elapsed = h('span', { class: 't-time' }, '00:00');
  const total = h('span', { class: 't-time t-total' }, '00:00');
  const cells: HTMLSpanElement[] = [];
  const bar = h('div', {
    class: 't-cells', role: 'slider', tabindex: 0, 'aria-label': 'Seek',
    'aria-valuemin': 0, 'aria-valuemax': 0, 'aria-valuenow': 0, 'aria-valuetext': '00:00',
  });
  for (let i = 0; i < CELLS; i++) { const c = h('span', { class: 'cell' }); cells.push(c); bar.append(c); }

  let live = false;
  let seekable = false;
  let duration = 0;
  let scrub: number | null = null;   // fraction while dragging
  let lastHead = -2;
  let lastLit = -1;

  const paintProgress = (p: number) => {
    const head = Math.min(CELLS - 1, Math.floor(p * CELLS));
    if (head === lastHead) return;
    lastHead = head;
    cells.forEach((c, i) => {
      c.classList.toggle('on', i < head);
      c.classList.toggle('head', i === head && duration > 0);
    });
  };
  const paintLevel = (level: number) => {
    const lit = Math.round(level * CELLS);
    if (lit === lastLit) return;
    lastLit = lit;
    cells.forEach((c, i) => {
      c.classList.toggle('on', i < lit - 1);
      c.classList.toggle('head', i === lit - 1);
    });
  };

  const fracAt = (x: number) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width));
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!seekable || live || e.button !== 0) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.focus({ preventScroll: true });
    scrub = fracAt(e.clientX);
    paintProgress(scrub);
    elapsed.textContent = formatTime(scrub * duration);
  });
  bar.addEventListener('pointermove', (e) => {
    if (scrub === null || !bar.hasPointerCapture(e.pointerId)) return;
    scrub = fracAt(e.clientX);
    paintProgress(scrub);
    elapsed.textContent = formatTime(scrub * duration);
  });
  const endScrub = (e: PointerEvent) => {
    if (scrub === null) return;
    if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId);
    engine.seek(scrub * duration);
    scrub = null;
  };
  bar.addEventListener('pointerup', endScrub);
  bar.addEventListener('pointercancel', endScrub);
  bar.addEventListener('keydown', (e) => {
    if (!seekable || live) return;
    const t = engine.state.currentTime;
    const to = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? t + 5
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? t - 5
        : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null;
    if (to === null) return;
    e.preventDefault();
    engine.seek(to);
  });

  play.addEventListener('click', () => void engine.toggle());

  let lastPlaying: boolean | null = null;
  d.add(engine.on('state', (s) => {
    const showPause = s.playing && !s.live;
    if (showPause !== lastPlaying) {
      lastPlaying = showPause;
      play.replaceChildren(svg(showPause ? ICONS.pause : ICONS.play));
      play.setAttribute('aria-label', showPause ? 'Pause' : 'Play');
    }
    if (s.source === null || s.live) play.setAttribute('aria-disabled', 'true');
    else play.removeAttribute('aria-disabled');
    const wasLive = live;
    live = s.live;
    seekable = s.seekable && Number.isFinite(s.duration) && s.duration > 0;
    duration = Number.isFinite(s.duration) ? s.duration : 0;
    el.classList.toggle('is-live', live);
    el.classList.toggle('is-playing', s.playing);
    bar.classList.toggle('is-seekable', seekable && !live);
    if (live !== wasLive) { lastHead = -2; lastLit = -1; }
    if (live) {
      elapsed.textContent = 'LIVE';
      bar.setAttribute('aria-disabled', 'true');
      return;
    }
    bar.toggleAttribute('aria-disabled', !seekable);
    total.textContent = formatTime(duration);
    bar.setAttribute('aria-valuemax', String(Math.round(duration)));
    if (scrub === null) {
      elapsed.textContent = formatTime(s.currentTime);
      bar.setAttribute('aria-valuenow', String(Math.round(s.currentTime)));
      bar.setAttribute('aria-valuetext', formatTime(s.currentTime));
      paintProgress(duration > 0 ? s.currentTime / duration : 0);
    }
  }));
  // Smooth playhead between timeupdate events, and the level bar for live sources.
  d.add(engine.on('level', (level) => {
    if (live) { paintLevel(level); return; }
    if (scrub === null && duration > 0 && engine.state.playing) paintProgress(engine.state.currentTime / duration);
  }));

  play.replaceChildren(svg(ICONS.play));
  play.setAttribute('aria-disabled', 'true');
  bar.setAttribute('aria-disabled', 'true');
  paintProgress(0);

  const el = h('div', { class: 'transport plate', role: 'group', 'aria-label': 'Transport' },
    play,
    h('div', { class: 't-strip' }, state, elapsed, bar, total),
  );
  return { el, dispose: () => d.dispose() };
}
