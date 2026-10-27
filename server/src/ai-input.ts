import { Buffer } from 'node:buffer';

export const MAX_AI_IMAGES = 6;
export const MAX_AI_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_AI_TEXT_CHARS = 60_000;
export interface WireText {
  type: 'text';
  text: string;
}
export interface WireImage {
  type: 'image_url';
  image_url: { url: string };
}
export interface WireMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | (WireText | WireImage)[];
}
export class AiInputError extends Error {}
const fail = (message: string): never => {
  throw new AiInputError(message);
};

/** Bounded data URLs only. Do not let the provider fetch arbitrary client-supplied addresses. */
export function validateAiImage(input: unknown): string {
  if (typeof input !== 'string' || input.length > Math.ceil(MAX_AI_IMAGE_BYTES / 3) * 4 + 64)
    fail('AI 图片不能超过 2 MB');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input as string);
  if (!match || match[2].length % 4 !== 0) return fail('AI 图片仅支持 PNG、JPEG 或 WebP 数据');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_AI_IMAGE_BYTES || bytes.toString('base64') !== match[2])
    fail('AI 图片数据无效或超过 2 MB');
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
  if (!width || !height || width > 8192 || height > 8192) fail('AI 图片格式或尺寸无效');
  return input as string;
}

export function cleanAiMessages(input: unknown): WireMessage[] {
  if (!Array.isArray(input) || !input.length || input.length > 40) fail('请发送 1–40 条消息');
  let textChars = 0,
    images = 0;
  const clean = (input as unknown[]).map((value): WireMessage => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('消息格式无效');
    const m = value as Record<string, unknown>;
    if (!['system', 'user', 'assistant'].includes(String(m.role))) return fail('消息格式无效');
    const role = m.role as WireMessage['role'];
    if (typeof m.content === 'string') {
      textChars += m.content.length;
      return { role, content: m.content };
    }
    if (role !== 'user' || !Array.isArray(m.content) || !m.content.length || m.content.length > 20)
      return fail('只有用户消息可附带图片或文件内容');
    const content = m.content.map((raw): WireText | WireImage => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('附件消息格式无效');
      const part = raw as Record<string, unknown>;
      if (part.type === 'text' && typeof part.text === 'string') {
        textChars += part.text.length;
        return { type: 'text', text: part.text };
      }
      if (
        part.type === 'image_url' &&
        part.image_url &&
        typeof part.image_url === 'object' &&
        !Array.isArray(part.image_url)
      ) {
        images++;
        if (images > MAX_AI_IMAGES) fail('一次最多发送 6 张 AI 图片');
        return { type: 'image_url', image_url: { url: validateAiImage((part.image_url as { url?: unknown }).url) } };
      }
      return fail('不支持这个附件内容类型');
    });
    return { role, content };
  });
  if (textChars > MAX_AI_TEXT_CHARS) fail('上下文过长，请减少选中的内容');
  return clean;
}
