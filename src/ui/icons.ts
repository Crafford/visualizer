/** Inline SVG icons (redrawn from the TE design), currentColor. */
const svg = (size: number, body: string, extra = '') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  /** Side panel: rounded rectangle with a divider on the left third (20 px). */
  sidebar: svg(20, '<rect x="3.2" y="4.1" width="13.6" height="11.8" rx="2" stroke="currentColor" stroke-width="1.42"/><path d="M8 4.4v11.2" stroke="currentColor" stroke-width="1.42"/>'),
  /** Fullscreen corners (20 px). */
  fullscreen: svg(20, '<path d="M3.6 7.6V3.6h4M12.4 3.6h4v4M16.4 12.4v4h-4M7.6 16.4h-4v-4" stroke="currentColor" stroke-width="1.42"/>'),
  /** Exit fullscreen: corners pointing inward (20 px). */
  fullscreenExit: svg(20, '<path d="M7.6 3.6v4h-4M16.4 7.6h-4v-4M12.4 16.4v-4h4M3.6 12.4h4v4" stroke="currentColor" stroke-width="1.42"/>'),
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
