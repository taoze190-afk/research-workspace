import { Buffer } from 'node:buffer';

export const MAX_AVATAR_BYTES = 64 * 1024;

/** Avatars are bounded raster data, never URLs, SVG or arbitrary HTML. */
export function parseAvatarDataUrl(input: unknown): string | null {
  if (input === null) return null;
  if (typeof input !== 'string') throw new Error('请选择有效的头像图片');
  if (input.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 32) throw new Error('头像不能超过 64 KB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match || match[2].length % 4 !== 0) throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_AVATAR_BYTES || bytes.toString('base64') !== match[2])
    throw new Error('头像图片无效或超过 64 KB');
  let width = 0,
    height = 0;
  if (
    match[1] === 'png' &&
    bytes.length >= 45 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR' &&
    bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  ) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (
    match[1] === 'jpeg' &&
    bytes.length > 12 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217
  ) {
    for (let at = 2; at + 8 < bytes.length; ) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(at);
      if (length < 2 || at + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(at + 3);
        width = bytes.readUInt16BE(at + 5);
        break;
      }
      at += length;
    }
  } else if (
    match[1] === 'webp' &&
    bytes.length >= 30 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP' &&
    bytes.readUInt32LE(4) + 8 === bytes.length
  ) {
    const format = bytes.toString('ascii', 12, 16);
    if (format === 'VP8X') {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    }
    if (format === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
    if (format === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    }
  }
  if (!width || !height || width > 512 || height > 512) throw new Error('头像图片无效，尺寸不能超过 512 × 512');
  return input;
}
