import { useCallback } from 'react';
import { setTaskStatus, updateTask, deleteTask, createTask, spawnNextTask } from '@/data/repo';
import { useData } from '@/state/DataContext';
import { useToast } from '@/components/ui/toast';
import { formatShortDate } from '@/domain/date';
import type { Priority, Task, TaskStatus } from '@/domain/types';

/** 任务的所有状态变更都走这里，保证看板、列表、工作台、项目进度读到的是同一份数据。 */
export function useTaskActions() {
  const { mutate } = useData();
  const toast = useToast();

  const setStatus = useCallback(
    async (task: Task, status: TaskStatus) => {
      const before = task.status;
      if (before === status) return;
      const ok = await mutate(() => setTaskStatus(task.id, status), { silent: true });
      if (!ok) return;
      toast({
        title: status === 'done' ? `已完成：${task.title}` : `已改为${status === 'doing' ? '进行中' : status === 'cancelled' ? '已取消' : '待办'}`,
        tone: 'success',
        action: { label: '撤销', onClick: () => void mutate(() => setTaskStatus(task.id, before), { silent: true }) },
      });
      // 重复任务完成后排下一期；撤销完成不会收回下一期，不需要时手动删掉即可
      if (status === 'done' && task.recurrence !== 'none') {
        const holder: { next: Task | null } = { next: null };
        const okSpawn = await mutate(async () => {
          holder.next = await spawnNextTask(task);
        }, { silent: true });
        if (okSpawn && holder.next) toast({ title: `下一期已排到 ${formatShortDate(holder.next.dueDate)}`, tone: 'info' });
      }
    },
    [mutate, toast]
  );

  const setPriority = useCallback(
    (task: Task, priority: Priority) => mutate(() => updateTask(task.id, { priority }), { silent: true }),
    [mutate]
  );

  const setDueDate = useCallback(
    (task: Task, dueDate: string | null) => mutate(() => updateTask(task.id, { dueDate }), { silent: true }),
    [mutate]
  );

  const remove = useCallback(
    async (task: Task) => {
      const ok = await mutate(() => deleteTask(task.id), { silent: true });
      if (!ok) return;
      toast({
        title: `已移到回收站：${task.title}`,
        description: '在「设置与数据 → 回收站」里可以恢复。',
        tone: 'info',
        action: {
          label: '撤销',
          onClick: () => void mutate(() => updateTask(task.id, { deletedAt: null }), { silent: true }),
        },
      });
    },
    [mutate, toast]
  );

  const duplicate = useCallback(
    (task: Task) =>
      mutate(
        () =>
          createTask({
            title: `${task.title} 副本`,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate,
            projectId: task.projectId,
            recurrence: task.recurrence,
          }),
        { success: '已复制' }
      ),
    [mutate]
  );

  return { setStatus, setPriority, setDueDate, remove, duplicate };
}
