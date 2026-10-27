import { useState } from 'react';
import { ChevronDown, FolderKanban, Star, Tags } from 'lucide-react';
import { READING_STATUSES, readingStatusLabels } from '@/domain/types';
import { cn } from '@/lib/cx';

export interface TreeState {
  project: string;
  tag: string;
  status: string;
  favorite: boolean;
}

/**
 * 文献分类树（桌面端左栏）：全部 / 收藏 / 阅读状态 / 项目 / 标签。
 * 点任意节点都会落到 URL 筛选参数上，与中栏卡片流、右栏详情联动。
 */
export function LibraryTree({
  state,
  projects,
  tags,
  onSelect,
}: {
  state: TreeState;
  projects: { id: string; name: string }[];
  tags: string[];
  onSelect: (patch: Partial<TreeState>) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (key: string) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  const itemCls = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-[13px] transition-colors duration-150',
      active ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-2 hover:bg-surface-subtle hover:text-ink',
    );

  const group = (key: string, icon: React.ReactNode, label: string, count: number, children: React.ReactNode) => (
    <div>
      <button
        type="button"
        className="flex min-h-9 w-full items-center gap-1.5 rounded-control px-2 py-1 text-[13px] font-medium text-ink-2 hover:bg-surface-subtle"
        aria-expanded={!collapsed[key]}
        onClick={() => toggle(key)}
      >
        <ChevronDown
          size={12}
          aria-hidden
          className={cn('transition-transform duration-150', collapsed[key] && '-rotate-90')}
        />
        {icon}
        <span className="flex-1 text-left">{label}</span>
        <span className="tabular-nums opacity-70">{count}</span>
      </button>
      {!collapsed[key] && <ul className="mt-0.5 flex flex-col gap-px pl-2">{children}</ul>}
    </div>
  );

  return (
    <nav aria-label="文献分类" className="flex flex-col gap-1.5">
      <button
        type="button"
        className={itemCls(!state.project && !state.tag && !state.status && !state.favorite)}
        onClick={() => onSelect({ project: '', tag: '', status: '', favorite: false })}
      >
        全部文献
      </button>
      <button type="button" className={itemCls(state.favorite)} onClick={() => onSelect({ favorite: !state.favorite })}>
        <Star size={13} aria-hidden className={state.favorite ? 'fill-current' : ''} />
        收藏
      </button>

      {group(
        'status',
        <Tags size={12} aria-hidden />,
        '阅读状态',
        READING_STATUSES.length,
        READING_STATUSES.map((s) => (
          <li key={s}>
            <button
              type="button"
              className={itemCls(state.status === s)}
              onClick={() => onSelect({ status: state.status === s ? '' : s, favorite: false })}
            >
              {readingStatusLabels[s]}
            </button>
          </li>
        )),
      )}

      {group(
        'project',
        <FolderKanban size={12} aria-hidden />,
        '项目',
        projects.length,
        projects.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={itemCls(state.project === p.id)}
              title={p.name}
              onClick={() => onSelect({ project: state.project === p.id ? '' : p.id, tag: '', favorite: false })}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          </li>
        )),
      )}

      {tags.length > 0 &&
        group(
          'tag',
          <Tags size={12} aria-hidden />,
          '标签',
          tags.length,
          tags.map((t) => (
            <li key={t}>
              <button
                type="button"
                className={itemCls(state.tag === t)}
                onClick={() => onSelect({ tag: state.tag === t ? '' : t, project: '', favorite: false })}
              >
                <span className="min-w-0 flex-1 truncate">{t}</span>
              </button>
            </li>
          )),
        )}
    </nav>
  );
}
