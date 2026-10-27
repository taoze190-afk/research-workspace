import { useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { describeAction, type ActionPreview, type ActionResult, type AiAction } from './actions';
import { cn } from '@/lib/cx';
import { scopeFromRecordHref } from './workflows';

/** 明细确认后才执行；每行保留成功或失败结果，失败可重试，成功不会重复采纳。 */
export function ActionCard({
  actions,
  busy,
  previews,
  results,
  executingIndex,
  onAdopt,
  onAdoptAll,
  onDismiss,
  onFollowUp,
}: {
  actions: AiAction[];
  busy?: boolean;
  previews?: (ActionPreview | null | undefined)[];
  results?: (ActionResult | null | undefined)[];
  executingIndex?: number | null;
  onAdopt: (action: AiAction) => void | Promise<unknown>;
  onAdoptAll?: () => void | Promise<unknown>;
  onDismiss: () => void;
  onFollowUp?: (result: ActionResult) => void;
}) {
  const [localPending, setLocalPending] = useState<AiAction | 'all' | null>(null);
  const [clientErrors, setClientErrors] = useState<Map<AiAction, string>>(() => new Map());
  const clickLock = useRef(false);
  if (actions.length === 0) return null;
  const locked = Boolean(busy || localPending);
  const run = async (action: AiAction | 'all') => {
    if (clickLock.current || locked) return;
    clickLock.current = true;
    setLocalPending(action);
    try {
      if (action === 'all') await onAdoptAll?.();
      else await onAdopt(action);
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存失败，请重试';
      setClientErrors((previous) => {
        const next = new Map(previous);
        for (const item of action === 'all' ? actions : [action]) next.set(item, message);
        return next;
      });
    } finally {
      clickLock.current = false;
      setLocalPending(null);
    }
  };
  const remaining = actions.filter((_, index) => !results?.[index]?.ok).length;
  return (
    <div className="ai-action-card" role="region" aria-label="AI 提议的动作" aria-busy={locked}>
      <div className="ai-action-card-head">
        <Sparkles size={14} aria-hidden />
        <span>{remaining ? `${remaining} 项待确认` : '操作已完成'}</span>
        <button
          type="button"
          className="ai-action-dismiss disabled:opacity-40"
          disabled={locked}
          aria-label="忽略全部提议"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <ul className="ai-action-list">
        {actions.map((action, index) => {
          const preview = previews?.[index];
          const result =
            results?.[index] ??
            (clientErrors.has(action) ? { ok: false, message: clientErrors.get(action)! } : undefined);
          const done = result?.ok;
          const running = localPending === action || (busy && executingIndex === index);
          return (
            <li
              key={`${action.action}-${index}`}
              className="ai-action-item !block"
              data-action-state={done ? 'done' : running ? 'running' : result ? 'failed' : 'pending'}
            >
              <div className="flex min-w-0 items-start gap-2">
                {actions.length > 1 && (
                  <span className="ai-action-index mt-2.5" aria-hidden>
                    {index + 1}
                  </span>
                )}
                <div className="min-w-0 flex-1 py-1.5">
                  <p className="break-words text-[14px] font-medium leading-6">
                    {preview?.title || describeAction(action)}
                  </p>
                  {preview?.target && (
                    <p className="mt-0.5 break-words text-[13px] leading-6 text-ink-2">{preview.target}</p>
                  )}
                </div>
                <Button
                  size="sm"
                  variant={done ? 'ghost' : 'secondary'}
                  disabled={locked || done || preview?.valid === false}
                  onClick={() => void run(action)}
                  aria-label={`${done ? '已执行' : result ? '重试' : '采纳'}：${preview?.title || describeAction(action)}`}
                >
                  {running ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : done ? (
                    <Check size={13} aria-hidden />
                  ) : null}
                  {done ? '已执行' : running ? '执行中' : result ? '重试' : '采纳'}
                </Button>
              </div>
              {preview?.changes.length ? (
                <details className="ml-0 mt-1 rounded-control border border-line bg-surface p-2.5 text-[13px]">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-ink-2">
                    <ChevronDown size={13} aria-hidden />
                    修改明细 <span className="ml-auto tabular-nums">{preview.changes.length}</span>
                  </summary>
                  <dl className="mt-3 flex max-h-[280px] flex-col gap-3 overflow-auto">
                    {preview.changes.map((change, item) => (
                      <div key={`${change.label}-${item}`} className="min-w-0">
                        <dt className="mb-1 font-medium">{change.label}</dt>
                        {change.before !== undefined && (
                          <dd className="mb-1 whitespace-pre-wrap break-words rounded bg-surface-subtle px-2 py-1.5 text-ink-2">
                            <span className="mr-2 text-[12px]">原内容</span>
                            {change.before}
                          </dd>
                        )}
                        <dd className="whitespace-pre-wrap break-words rounded border-l-2 border-brand bg-brand-soft px-2 py-1.5">
                          <span className="mr-2 text-[12px]">{change.before === undefined ? '新增' : '修改后'}</span>
                          {change.after}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ) : null}
              {preview?.warnings.map((warning) => (
                <p key={warning} className="mt-2 break-words text-[13px] leading-6 text-ink-2">
                  {warning}
                </p>
              ))}
              {preview?.error && (
                <p role="alert" className="mt-2 break-words text-[13px] leading-6 text-danger">
                  {preview.error}
                </p>
              )}
              {result && (
                <div
                  role="status"
                  className={cn(
                    'mt-2 flex flex-wrap items-center gap-2 text-[13px] leading-6',
                    done ? 'text-brand-ink' : 'text-danger',
                  )}
                >
                  <span className="min-w-0 break-words">{result.message}</span>
                  {done && result.href && (
                    <Link to={result.href} className="underline underline-offset-2">
                      查看记录
                    </Link>
                  )}
                  {done && result.href && onFollowUp && scopeFromRecordHref(result.href) && (
                    <button
                      type="button"
                      className="underline underline-offset-2"
                      disabled={locked}
                      onClick={() => onFollowUp(result)}
                    >
                      继续跟进
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {actions.length > 1 && onAdoptAll && remaining > 0 && (
        <div className="ai-action-card-body">
          <Button
            size="sm"
            variant="primary"
            disabled={locked || previews?.some((preview, index) => !results?.[index]?.ok && preview?.valid === false)}
            onClick={() => void run('all')}
          >
            {localPending === 'all' ? (
              <Loader2 size={13} className="animate-spin" aria-hidden />
            ) : (
              <Check size={13} aria-hidden />
            )}
            全部采纳
          </Button>
          <span className="ai-action-note">{remaining} 项操作</span>
        </div>
      )}
    </div>
  );
}

export function ActionResultBar({ result }: { result: ActionResult }) {
  return (
    <div className={cn('ai-action-result', result.ok ? 'is-ok' : 'is-fail')} role="status">
      <span>{result.message}</span>
      {result.ok && result.href && (
        <Link className="ai-action-goto" to={result.href}>
          查看记录
        </Link>
      )}
    </div>
  );
}
