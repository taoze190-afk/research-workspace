export function createId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  // file:// 或非安全上下文下 randomUUID 不可用，退回时间戳 + 随机段。
  const rnd = new Uint32Array(4);
  if (c?.getRandomValues) c.getRandomValues(rnd);
  else for (let i = 0; i < 4; i++) rnd[i] = Math.floor(Math.random() * 0xffffffff);
  return `id-${Date.now().toString(36)}-${Array.from(rnd, (n) => n.toString(36).padStart(7, '0')).join('')}`;
}

export function newBase(isDemo = false) {
  const now = Date.now();
  return { id: createId(), createdAt: now, updatedAt: now, deletedAt: null, isDemo };
}
