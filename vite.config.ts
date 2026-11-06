// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import { defineConfig } from 'vite';

// base './' so the build works from any static path (GitHub Pages, S3, a subfolder).
export default defineConfig({
  base: './',
  // three.js alone is ~500 kB minified; the warning is expected for a single-page visualizer.
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 800 },
});
