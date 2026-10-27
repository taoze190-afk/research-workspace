import { describe, expect, it } from 'vitest';
import { buildMessages, extractJson, loadAiConfig, saveAiConfig, setAiConfigOwner } from '@/lib/ai';

describe('模型回复的 JSON 提取', () => {
  it('裸 JSON 直接解析', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('[1,2,3]')).toEqual([1, 2, 3]);
  });

  it('```json 围栏与前后废话都能剥掉', () => {
    const text =
      '好的，以下是结果：\n```json\n{"motivation":"m","methodology":"x","baselines":"b","limitations":"l"}\n```\n请查收。';
    expect(extractJson(text)).toMatchObject({ motivation: 'm' });
  });

  it('花括号里嵌套字符串内容不干扰解析', () => {
    const text =
      '```json\n{"phases":[{"name":"阶段 {一}","tasks":[{"title":"跑 lr=1e-4 & 消融","daysFromNow":3,"priority":"high"}]}]}\n```';
    const parsed = extractJson(text) as { phases: { tasks: { title: string }[] }[] };
    expect(parsed.phases[0].tasks[0].title).toContain('lr=1e-4');
  });

  it('解析不出返回 null', () => {
    expect(extractJson('这不是 JSON')).toBeNull();
    expect(extractJson('```json\n{broken\n```')).toBeNull();
  });
});

describe('消息组装', () => {
  it('系统角色在最前，上下文第二，历史只保留最近 6 条，用户请求最后', () => {
    const history = Array.from({ length: 8 }, (_, i) => ({ role: 'user' as const, content: `h${i}` }));
    const messages = buildMessages('系统提示', '上下文块', history, '新问题');
    expect(messages[0]).toMatchObject({ role: 'system', content: '系统提示' });
    expect(messages[1]).toMatchObject({ role: 'system', content: expect.stringContaining('上下文块') });
    expect(messages).toHaveLength(1 + 1 + 6 + 1);
    expect(messages.at(-1)).toMatchObject({ role: 'user', content: '新问题' });
  });

  it('空上下文不插入占位', () => {
    const messages = buildMessages('s', '', [], 'q');
    expect(messages).toHaveLength(2);
  });
});

describe('个人模型配置按账号隔离', () => {
  it('不同账号和本地模式不会读取彼此的个人密钥', () => {
    setAiConfigOwner('account-a');
    saveAiConfig({
      enabled: true,
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'account-a-test-key',
      model: 'test-model',
    });
    setAiConfigOwner('account-b');
    expect(loadAiConfig().apiKey).toBe('');
    setAiConfigOwner(null);
    expect(loadAiConfig().apiKey).not.toBe('account-a-test-key');
    setAiConfigOwner('account-a');
    expect(loadAiConfig().apiKey).toBe('account-a-test-key');
    setAiConfigOwner(null);
  });
});
