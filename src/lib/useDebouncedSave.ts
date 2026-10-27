import { useCallback, useEffect, useRef, useState } from 'react';
import { registerPendingSave } from './pendingSaves';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed';

/**
 * 防抖自动保存：内容变化后停留 delay 毫秒才写库。
 * 失败时不回滚表单，state 变 failed，由界面给出重试；离开页面（卸载）时把待写的最后一次立刻发出。
 */
export function useDebouncedSave<T>(
  values: T,
  save: (values: T) => Promise<boolean>,
  options?: { delay?: number; enabled?: boolean },
) {
  const delay = options?.delay ?? 800;
  const enabled = options?.enabled ?? true;
  const [state, setState] = useState<SaveState>('idle');
  const timer = useRef<number | null>(null);
  const latest = useRef(values);
  const saveRef = useRef(save);
  const enabledRef = useRef(enabled);
  const mounted = useRef(true);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const baseline = useRef(JSON.stringify(values));
  latest.current = values;
  saveRef.current = save;
  enabledRef.current = enabled;

  const flush = useCallback(async () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (inFlight.current) return inFlight.current;
    // 同一条记录串行写入。保存中继续输入时，下一轮写最新快照，旧请求不能覆盖新内容或提前显示“已保存”。
    const operation = Promise.resolve()
      .then(async () => {
        while (JSON.stringify(latest.current) !== baseline.current) {
          const value = latest.current;
          const snapshot = JSON.stringify(value);
          if (mounted.current) setState('saving');
          let ok = false;
          try {
            ok = await saveRef.current(value);
          } catch {
            /* 保留草稿供重试 */
          }
          if (!ok) {
            if (mounted.current) setState('failed');
            return false;
          }
          baseline.current = snapshot;
        }
        if (mounted.current) setState('saved');
        return true;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = operation;
    return operation;
  }, []);

  useEffect(() => {
    const snapshot = JSON.stringify(values);
    if (snapshot === baseline.current) {
      if (!inFlight.current) setState((previous) => (previous === 'idle' ? previous : 'saved'));
      return;
    }
    if (!inFlight.current) setState('dirty');
    if (!enabled) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), delay);
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [values, delay, enabled, flush]);

  // 正常路由切换也会走到这里：先把最后一次的编辑内容写出去，不留半截。
  useEffect(() => {
    mounted.current = true;
    const unregister = registerPendingSave(() => (enabledRef.current ? flush() : Promise.resolve(true)));
    return () => {
      unregister();
      mounted.current = false;
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      if (enabledRef.current && JSON.stringify(latest.current) !== baseline.current) void flush();
    };
  }, [flush]);

  const markSaved = useCallback(() => {
    baseline.current = JSON.stringify(latest.current);
    setState('saved');
  }, []);

  return { state, flush, markSaved, isDirty: state === 'dirty' || state === 'failed' };
}
