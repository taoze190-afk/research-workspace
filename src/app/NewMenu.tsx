import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookPlus, FilePlus2, FolderPlus, ListPlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown';
import { DropdownContent, MenuRow } from '@/components/ui/dropdown';
import { TaskFormDialog, emptyTaskDraft } from '@/features/tasks/TaskFormDialog';
import { ProjectFormDialog, emptyProjectDraft } from '@/features/projects/ProjectFormDialog';
import { ReferenceFormDialog, emptyReferenceDraft } from '@/features/library/ReferenceFormDialog';
import { useData } from '@/state/DataContext';
import { createExperiment } from '@/data/repo';

/** 全局新建入口：一个菜单，不给每个实体单开导航模块。 */
export function NewMenu({
  defaultProjectId,
  variant = 'primary',
  size = 'md',
}: {
  defaultProjectId?: string | null;
  variant?: 'primary' | 'secondary';
  size?: 'sm' | 'md';
}) {
  const navigate = useNavigate();
  const { mutate } = useData();
  const [taskOpen, setTaskOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);

  const newExperiment = async () => {
    let id = '';
    await mutate(
      async () => {
        const row = await createExperiment({ projectId: defaultProjectId ?? null });
        id = row.id;
      },
      { success: '已保存草稿' }
    );
    if (id) navigate(`/experiments/${id}`);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} aria-label="新建">
            <Plus size={size === 'sm' ? 15 : 16} aria-hidden />
            新建
          </Button>
        </DropdownMenuTrigger>
        <DropdownContent>
          <MenuRow icon={<ListPlus size={15} />} onSelect={() => setTaskOpen(true)}>
            新建任务
          </MenuRow>
          <MenuRow icon={<FolderPlus size={15} />} onSelect={() => setProjectOpen(true)}>
            新建项目
          </MenuRow>
          <MenuRow icon={<FilePlus2 size={15} />} onSelect={() => void newExperiment()}>
            新建实验记录
          </MenuRow>
          <MenuRow icon={<BookPlus size={15} />} onSelect={() => setReferenceOpen(true)}>
            新增文献条目
          </MenuRow>
          <DropdownMenuSeparator />
          <MenuRow onSelect={() => navigate('/settings')}>备份与导入</MenuRow>
        </DropdownContent>
      </DropdownMenu>

      <TaskFormDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        draft={emptyTaskDraft({ projectId: defaultProjectId ?? null })}
      />
      <ProjectFormDialog
        open={projectOpen}
        onOpenChange={setProjectOpen}
        draft={emptyProjectDraft()}
        onSaved={(p) => navigate(`/projects/${p.id}`)}
      />
      <ReferenceFormDialog
        open={referenceOpen}
        onOpenChange={setReferenceOpen}
        draft={emptyReferenceDraft()}
        onSaved={(r) => navigate(`/library?focus=${r.id}`)}
        onOpenExisting={(id) => {
          setReferenceOpen(false);
          navigate(`/library?focus=${id}`);
        }}
      />
    </>
  );
}
