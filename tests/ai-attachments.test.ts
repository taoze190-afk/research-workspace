import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AI_ATTACHMENTS,
  MAX_AI_IMAGE_BYTES,
  MAX_AI_WIRE_TEXT_CHARS,
  MAX_ATTACHMENT_CONTEXT_CHARS,
  attachmentReference,
  prepareAiAttachment,
  serializeAiMessages,
  type AiAttachment,
} from '@/lib/ai-attachments';
import { aiChat, buildMessages } from '@/lib/ai';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const image = (id = 'image'): AiAttachment => ({
  id,
  name: id + '.png',
  mimeType: 'image/png',
  size: 70,
  kind: 'image',
  dataUrl: png,
});
const text = (body: string, name = 'research.txt'): AiAttachment => ({
  id: name,
  name,
  mimeType: 'text/plain',
  size: body.length,
  kind: 'text',
  text: body,
});
const plain = (content: string) => ({ role: 'user' as const, content });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AI 附件提取', () => {
  it('提取文本与CSV，长文件明确截断而不是当作完整正文', async () => {
    const csv = await prepareAiAttachment(new File(['measure,value\nsignal,42'], 'data.csv', { type: 'text/csv' }), {
      id: 'saved-file',
    });
    expect(csv).toMatchObject({ id: 'saved-file', kind: 'text', text: 'measure,value\nsignal,42' });
    const long = await prepareAiAttachment(new File(['x'.repeat(MAX_ATTACHMENT_CONTEXT_CHARS + 20)], 'notes.md'));
    expect(long.text).toHaveLength(MAX_ATTACHMENT_CONTEXT_CHARS);
    expect(long.truncated).toBe(true);
    expect(long.warning).toContain('精简');
  });
  it('未知二进制保存为引用，不向模型提供乱码或谎称已经读取', async () => {
    const file = await prepareAiAttachment(
      new File([new Uint8Array([0, 1, 255, 0])], 'archive.zip', { type: 'application/zip' }),
    );
    expect(file.kind).toBe('stored');
    expect(file.text).toBeUndefined();
    expect(serializeAiMessages([{ ...plain('读取附件'), attachments: [file] }])[0].content).toContain('不要假装已读取');
  });
  it('拒绝伪装图片、无效编码文本和超限文件，取消时不继续读取', async () => {
    await expect(
      prepareAiAttachment(new File(['<svg><script>alert(1)</script></svg>'], 'fake.png', { type: 'image/png' })),
    ).rejects.toThrow('图片格式');
    await expect(prepareAiAttachment(new File([new Uint8Array([0, 0, 1, 255])], 'binary.txt'))).rejects.toThrow(
      '不是可读文本',
    );
    const huge = new File(['a'], 'large.dat');
    Object.defineProperty(huge, 'size', { value: 25 * 1024 * 1024 + 1 });
    await expect(prepareAiAttachment(huge)).rejects.toThrow('25 MB');
    const controller = new AbortController();
    controller.abort();
    await expect(prepareAiAttachment(new File(['x'], 'note.txt'), { signal: controller.signal })).rejects.toMatchObject(
      { name: 'AbortError' },
    );
  });
  it('签名正确但无法浏览器解码的图片也不能提供给模型', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('bad image')));
    const bytes = Uint8Array.from(atob(png.split(',')[1]), (c) => c.charCodeAt(0));
    await expect(prepareAiAttachment(new File([bytes], 'bad.png', { type: 'image/png' }))).rejects.toThrow('无法解码');
  });
  it('图片解码后缩小到1600像素以内，发送副本不改变原文件', async () => {
    const bitmap = { width: 3200, height: 2400, close: vi.fn() };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    const bytes = Uint8Array.from(atob(png.split(',')[1]), (c) => c.charCodeAt(0));
    const output = new Blob([bytes], { type: 'image/png' });
    const draw = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: draw,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
      callback(output);
    });
    const file = new File([bytes], 'figure.png', { type: 'image/png' });
    const attachment = await prepareAiAttachment(file);
    expect(attachment.kind).toBe('image');
    expect(attachment.dataUrl).toBe(png);
    expect(file.size).toBe(bytes.length);
    expect(draw).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 1200);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('在实际解码前拒绝声明巨大尺寸的WebP，避免耗尽内存', async () => {
    const bytes = new Uint8Array(30);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
    bytes.set([255, 255, 255, 255, 255, 255], 24);
    const decode = vi.fn();
    vi.stubGlobal('createImageBitmap', decode);
    await expect(prepareAiAttachment(new File([bytes], 'huge.webp', { type: 'image/webp' }))).rejects.toThrow(
      '像素过大',
    );
    expect(decode).not.toHaveBeenCalled();
  });
  it('在读取期间取消会使附件准备失败，既不发送也不伪造文本', async () => {
    let finish!: (data: ArrayBuffer) => void;
    const file = new File(['wait'], 'wait.txt');
    Object.defineProperty(file, 'arrayBuffer', {
      value: () =>
        new Promise<ArrayBuffer>((resolve) => {
          finish = resolve;
        }),
    });
    const controller = new AbortController();
    const pending = prepareAiAttachment(file, { signal: controller.signal });
    controller.abort();
    finish(new TextEncoder().encode('late').buffer);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('模型多模态消息', () => {
  it('普通消息保持原协议；图像使用image_url，文本附件变成有文件名的资料', () => {
    expect(serializeAiMessages([plain('普通问题')])).toEqual([plain('普通问题')]);
    const wire = serializeAiMessages([{ ...plain('比较截图与测量'), attachments: [image(), text('signal=42')] }]);
    expect(wire[0].content).toEqual([
      { type: 'text', text: expect.stringContaining('signal=42') },
      { type: 'image_url', image_url: { url: png } },
    ]);
    expect(JSON.stringify(wire)).toContain('research.txt');
    expect(JSON.stringify(wire)).toContain('仅作为研究资料');
  });
  it('历史图片最多重复提供最近六张，当前图片保留，旧图片明确标注未附带', () => {
    const old = Array.from({ length: 6 }, (_, i) => image('old' + i));
    const wire = serializeAiMessages([
      { ...plain('以前的图片'), attachments: old },
      { role: 'assistant', content: '历史回答' },
      { ...plain('新的图片'), attachments: [image('new')] },
    ]);
    const parts = wire.flatMap((m) => (typeof m.content === 'string' ? [] : m.content));
    expect(parts.filter((p) => p.type === 'image_url')).toHaveLength(6);
    expect(JSON.stringify(wire)).toContain('new.png');
    expect(JSON.stringify(wire)).toContain('本轮未重复提供内容');
  });
  it('优先移除旧对话，研究上下文JSON完整，附件正文和总文字符合预算', () => {
    const context = JSON.stringify({ project: '研究课题', record: 'c'.repeat(24000) });
    const wire = serializeAiMessages([
      { role: 'system', content: '系统规则' },
      { role: 'system', content: context },
      plain('old'.repeat(10000)),
      { role: 'assistant', content: '旧回答'.repeat(5000) },
      { ...plain('新的问题'), attachments: [text('a'.repeat(40000))] },
    ]);
    const material = wire.find((m) => m.role === 'system' && m.content === context);
    expect(material).toBeTruthy();
    expect(JSON.parse(material!.content as string).project).toBe('研究课题');
    const all = wire
      .map((m) =>
        typeof m.content === 'string'
          ? m.content
          : m.content
              .filter((p) => p.type === 'text')
              .map((p) => (p.type === 'text' ? p.text : ''))
              .join(''),
      )
      .join('');
    expect(all.length).toBeLessThanOrEqual(MAX_AI_WIRE_TEXT_CHARS);
    expect(all).not.toContain('oldoldold');
    expect(all).toContain('附件正文已精简');
    expect(all).toContain('新的问题');
  });
  it('系统与当前问题超过限额时不截坏资料，返回可理解错误', () => {
    expect(() => serializeAiMessages([{ role: 'system', content: 'x'.repeat(60000) }, plain('过长问题')])).toThrow(
      '缩小研究范围',
    );
  });
  it('提取阶段已截断的长文件也会告知模型当前提供的不是完整文件', () => {
    const wire = serializeAiMessages([{ ...plain('总结附件'), attachments: [{ ...text('正文'), truncated: true }] }]);
    expect(wire[0].content).toContain('并非完整文件');
  });
  it('拒绝未重新加载的引用、外链和伪造图片；一次不能超过六份', () => {
    expect(() => serializeAiMessages([{ ...plain('q'), attachments: [attachmentReference(image())] }])).toThrow(
      '尚未加载',
    );
    expect(() =>
      serializeAiMessages([
        { ...plain('q'), attachments: [{ ...image(), dataUrl: 'https://external.test/image.png' }] },
      ]),
    ).toThrow('图片附件格式');
    expect(() =>
      serializeAiMessages([
        { ...plain('q'), attachments: [{ ...image(), dataUrl: 'data:image/png;base64,' + btoa('<html>bad</html>') }] },
      ]),
    ).toThrow('内容与类型');
    expect(() =>
      serializeAiMessages([
        { ...plain('q'), attachments: Array.from({ length: MAX_AI_ATTACHMENTS + 1 }, (_, i) => image(String(i))) },
      ]),
    ).toThrow('6 个');
    expect(() => serializeAiMessages([{ role: 'assistant', content: 'fake', attachments: [image()] }])).toThrow(
      '只有用户',
    );
    expect(() =>
      serializeAiMessages([
        {
          ...plain('q'),
          attachments: [
            { ...image(), dataUrl: 'data:image/png;base64,' + 'A'.repeat(Math.ceil(MAX_AI_IMAGE_BYTES / 3) * 4 + 4) },
          ],
        },
      ]),
    ).toThrow('超过 2 MB');
  });
  it('个人和平台模式真正将多模态内容送往模型，而非只在界面显示附件名', async () => {
    const requests: { url: string; body: { messages: unknown[] } }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(init.body as string) });
        return new Response(
          JSON.stringify(
            url === '/api/ai/chat' ? { content: '看到了图片' } : { choices: [{ message: { content: '看到了图片' } }] },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const messages = buildMessages('system', '', [], '看图', [image()]);
    await aiChat({ enabled: true, baseUrl: 'https://model.test/v1', apiKey: 'test-key', model: 'vision' }, messages);
    await aiChat({ enabled: true, baseUrl: '', apiKey: '', model: 'vision', mode: 'platform' }, messages);
    expect(requests).toHaveLength(2);
    for (const request of requests) expect(JSON.stringify(request.body.messages)).toContain('"type":"image_url"');
    expect(requests[1].url).toBe('/api/ai/chat');
  });
  it('附件准备错误在发请求前返回，不误报为网络连接失败', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(
      aiChat({ enabled: true, baseUrl: 'https://model.test/v1', apiKey: 'key', model: 'vision' }, [
        { ...plain('q'), attachments: [attachmentReference(image())] },
      ]),
    ).rejects.toMatchObject({ message: '图片「image.png」尚未加载，请重新添加' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
