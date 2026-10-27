import { Badge, type Tone } from '@/components/ui/badge';
import {
  experimentStatusLabels,
  priorityLabels,
  projectStatusLabels,
  readingStatusLabels,
  taskStatusLabels,
  type ExperimentStatus,
  type Priority,
  type ProjectStatus,
  type ReadingStatus,
  type TaskStatus,
} from '@/domain/types';

const projectTone: Record<ProjectStatus, Tone> = {
  planned: 'info',
  active: 'brand',
  paused: 'warning',
  completed: 'neutral',
  archived: 'muted',
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge tone={projectTone[status]} withDot>
      {projectStatusLabels[status]}
    </Badge>
  );
}

const taskTone: Record<TaskStatus, Tone> = {
  todo: 'muted',
  doing: 'info',
  done: 'brand',
  cancelled: 'neutral',
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <Badge tone={taskTone[status]}>{taskStatusLabels[status]}</Badge>;
}

const priorityTone: Record<Priority, Tone> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'caution',
  low: 'muted',
};

/** 优先级用文字为主、色调为辅：紧急红、高橙、中黄。 */
export function PriorityBadge({ priority, compact }: { priority: Priority; compact?: boolean }) {
  if (compact) {
    return (
      <span
        title={priorityLabels[priority]}
        aria-label={`优先级：${priorityLabels[priority]}`}
        className={`inline-block size-2 rounded-full ${priority === 'urgent' ? 'bg-danger' : priority === 'high' ? 'bg-warning' : priority === 'medium' ? 'bg-caution' : 'bg-line-strong'}`}
      />
    );
  }
  return (
    <Badge tone={priorityTone[priority]}>
      {priorityLabels[priority]}
    </Badge>
  );
}

const experimentTone: Record<ExperimentStatus, Tone> = {
  draft: 'muted',
  active: 'info',
  done: 'success',
  failed: 'danger',
};

/** 实验状态：进行中的点带呼吸动画，失败红、完成绿。 */
export function ExperimentStatusBadge({ status }: { status: ExperimentStatus }) {
  return (
    <Badge tone={experimentTone[status]} withDot className={status === 'active' ? '[&>span]:anim-breathe' : undefined}>
      {experimentStatusLabels[status]}
    </Badge>
  );
}

const readingTone: Record<ReadingStatus, Tone> = {
  unread: 'muted',
  reading: 'info',
  read: 'brand',
};

export function ReadingStatusBadge({ status }: { status: ReadingStatus }) {
  return (
    <Badge tone={readingTone[status]} withDot>
      {readingStatusLabels[status]}
    </Badge>
  );
}
