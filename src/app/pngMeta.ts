// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jaco Crafford. See NOTICE for additional terms.

/** Author and source metadata written into exported PNGs (tEXt chunks, invisible in the image). */
export const PNG_CREDIT = {
  Author: 'Jaco Crafford',
  Software: 'AVZ1 Visualizer',
  Source: 'https://github.com/Crafford/visualizer',
  Copyright: 'Copyright (C) 2026 Jaco Crafford, AGPL-3.0-only',
} as const;

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One tEXt chunk: length, type, keyword NUL text (Latin-1), CRC over type + data. */
function textChunk(keyword: string, text: string): Uint8Array<ArrayBuffer> {
  const data = new Uint8Array(keyword.length + 1 + text.length);
  for (let i = 0; i < keyword.length; i++) data[i] = keyword.charCodeAt(i) & 0xff;
  data[keyword.length] = 0;
  for (let i = 0; i < text.length; i++) data[keyword.length + 1 + i] = text.charCodeAt(i) & 0xff;
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Returns the PNG with tEXt chunks inserted after IHDR; returns the input unchanged if it is not a PNG. */
export async function withPngText(png: Blob, fields: Record<string, string> = PNG_CREDIT): Promise<Blob> {
  const bytes = new Uint8Array(await png.arrayBuffer());
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 33 || sig.some((b, i) => bytes[i] !== b)) return png;
  const ihdrEnd = 8 + 12 + new DataView(bytes.buffer).getUint32(8); // signature + IHDR chunk
  const chunks = Object.entries(fields).map(([k, v]) => textChunk(k, v));
  const parts: BlobPart[] = [bytes.slice(0, ihdrEnd).buffer, ...chunks.map((c) => c.buffer as ArrayBuffer), bytes.slice(ihdrEnd).buffer];
  return new Blob(parts, { type: "image/png" });
}
