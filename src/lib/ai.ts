/**
 * AI 客户端：OpenAI 兼容协议（DeepSeek / GLM / Kimi / OpenAI / 本地 Ollama 都在这一类）。
 * 个人接口按账号保存在本机，调用时直连所选服务商；平台模式通过本站网关，不向浏览器下发密钥。
 */
import { serializeAiMessages, type AiAttachment } from './ai-attachments';
import type { ResearchTrace } from '@/features/ai/provenance';
export { serializeAiMessages } from './ai-attachments';
export type { AiAttachment } from './ai-attachments';

export interface AiConfig {
  mode?: 'personal' | 'platform';
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

const KEY = 'rw.ai.v1';
let configOwner: string | null = null;
export function setAiConfigOwner(userId: string | null) {
  configOwner = userId;
}
const configKey = () => (configOwner ? `${KEY}.${configOwner}` : KEY);

export const AI_PRESETS: { id: string; label: string; baseUrl: string; model: string; keyHint: string }[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyHint: 'sk-…',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: '',
    keyHint: 'Google AI Studio Key',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    keyHint: '….',
  },
  { id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', keyHint: 'sk-…' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-…' },
  {
    id: 'ollama',
    label: 'Ollama 本地',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.1',
    keyHint: '本地无需 Key',
  },
];

export function loadAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(configKey());
    if (!raw) return { enabled: false, baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: AI_PRESETS[0].model };
    return { enabled: false, baseUrl: '', apiKey: '', model: '', ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch {
    return { enabled: false, baseUrl: AI_PRESETS[0].baseUrl, apiKey: '', model: AI_PRESETS[0].model };
  }
}

export function saveAiConfig(config: AiConfig): void {
  try {
    localStorage.setItem(configKey(), JSON.stringify(config));
  } catch {
    /* 隐私模式写不进去就留在内存里 */
  }
}

export function aiReady(config: AiConfig): boolean {
  if (config.mode === 'platform') return config.enabled;
  return Boolean(config.enabled && config.baseUrl.trim() && config.model.trim());
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  attachments?: AiAttachment[];
  research?: ResearchTrace;
}

export class AiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ChatOptions {
  signal?: AbortSignal;
  /** 流式回调：增量文本。不传则走非流式一次性返回。 */
  onDelta?: (delta: string) => void;
  timeoutMs?: number;
}

/** 调 /chat/completions。流式解析 SSE；失败时抛 AiError（消息已按用户可读组织）。 */
export async function aiChat(config: AiConfig, messages: AiMessage[], options: ChatOptions = {}): Promise<string> {
  if (!aiReady(config)) throw new AiError(0, '还没有配置 AI 服务');
  if (options.signal?.aborted) throw new AiError(0, '已停止生成');
  let wireMessages: ReturnType<typeof serializeAiMessages>;
  try {
    wireMessages = serializeAiMessages(messages);
  } catch (error) {
    throw new AiError(0, (error as Error).message);
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 120000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.signal?.aborted) controller.abort();
    const platform = config.mode === 'platform';
    const res = await fetch(platform ? '/api/ai/chat' : `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(platform ? { 'x-rw-client': 'rw' } : config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify(
        platform
          ? { messages: wireMessages }
          : { model: config.model, messages: wireMessages, stream: Boolean(options.onDelta), temperature: 0.4 },
      ),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as { error?: { message?: string } | string };
        detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '');
      } catch {
        /* 保留空 detail */
      }
      throw new AiError(res.status, detail ? `模型服务返回 ${res.status}：${detail}` : `模型服务返回 ${res.status}`);
    }

    if (platform) {
      const json = (await res.json()) as { content?: string };
      const content = json.content ?? '';
      options.onDelta?.(content);
      return content;
    }
    if (!options.onDelta) {
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? '';
    }

    // SSE 流式：逐行读 data: 载荷，拼出全文
    const reader = res.body?.getReader();
    if (!reader) throw new AiError(0, '当前浏览器不支持流式读取');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
          const delta = json.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            full += delta;
            options.onDelta(delta);
          }
        } catch {
          /* 半截 JSON 留在 buffer 里等下一块 */
        }
      }
    }
    return full;
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new AiError(0, '已停止生成');
    if (error instanceof AiError) throw error;
    throw new AiError(0, `连不上模型服务：${(error as Error).message}`);
  } finally {
    window.clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}

/** 模型回复里的 JSON 提取：容忍 ```json 围栏与前后废话，解析失败返回 null。 */
export function extractJson(text: string): unknown | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidates = [fenced?.[1], text].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
    if (end <= start) continue;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}

/** 组消息：系统角色 + 当前上下文块 + 用户请求。上下文永远来自本库真实数据。 */
export function buildMessages(
  system: string,
  context: string,
  history: AiMessage[],
  user: string,
  attachments?: AiAttachment[],
): AiMessage[] {
  const messages: AiMessage[] = [{ role: 'system', content: system }];
  if (context)
    messages.push({ role: 'system', content: `【当前工作台上下文（来自本机数据，回答时优先引用）】\n${context}` });
  messages.push(
    ...history
      .slice(-6)
      .map(({ role, content, attachments }) => ({ role, content, ...(attachments?.length ? { attachments } : {}) })),
  );
  messages.push({ role: 'user', content: user, ...(attachments?.length ? { attachments } : {}) });
  return messages;
}

export const AI_SYSTEM =
  '你是「研序」科研工作台的 AI 副驾驶，面向研究生与科研人员。用简体中文回答，简洁、直接、可执行；引用数据时注明来自上下文的哪条记录；不确定就说不确定，绝不编造文献或数据。';
