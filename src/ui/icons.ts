// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
/** Inline SVG icons (redrawn from the TE design), currentColor. */
const svg = (size: number, body: string, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  /** Side panel (16 px, 137:10): 12x10 rounded rectangle, divider at x 6.5. */
  sidebar: svg(16, '<rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M6.5 3v10" stroke="currentColor" stroke-width="1.3"/>'),
  /** Fullscreen corners (16 px, 139:63): 11x11 box, 3.5 px arms, round caps. */
  fullscreen: svg(16, '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** Exit fullscreen: the same corners turned inward (16 px). */
  fullscreenExit: svg(16, '<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  /** Upload: arrow onto a base line (12 px). */
  upload: svg(12, '<path d="M6 8.2V2.4M3.4 5 6 2.4 8.6 5M2 10.2h8" stroke="currentColor" stroke-width="1.4"/>'),
  /** Record: ring + dot (12 px). */
  record: svg(12, '<circle cx="6" cy="6" r="4.7" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6" r="2.15" fill="currentColor"/>'),
  /** Filled dot (12 px), the screenshot key's legend. */
  dot: svg(12, '<circle cx="6" cy="6" r="4" fill="currentColor"/>'),
  play: svg(12, '<path d="M3 1.8v8.4L10.2 6z" fill="currentColor"/>'),
  pause: svg(12, '<path d="M2.2 2h2.4v8H2.2zM7.2 2h2.4v8H7.2z" fill="currentColor"/>'),
  chevron: svg(10, '<path d="M2.5 4 5 6.5 7.5 4" stroke="currentColor" stroke-width="1.5"/>'),
} as const;
