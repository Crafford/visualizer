// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.
import type { Skin } from './types';
import { TE_SKIN } from './te/TePanel';
import { BRAUN_SKIN } from './braun/BraunPanel';

/**
 * Skin registry (M15). A skin is a folder with its tokens CSS (light / dark), component CSS,
 * fonts and a panel renderer mapping the abstract panel model (ui/model.ts) onto its own
 * controls. To add one: the folder, an entry here and one in themes.ts THEMES.
 */
export const SKINS: readonly Skin[] = [TE_SKIN, BRAUN_SKIN];

export const getSkin = (id: string): Skin => SKINS.find((s) => s.id === id) ?? SKINS[0];
