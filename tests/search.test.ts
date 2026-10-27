import { describe, expect, it } from 'vitest';
import { searchAll } from '@/domain/search';
import { dataset, makeProject, makeReference, makeTag, makeTask } from './factory';
import type { EntityTag } from '@/domain/types';

const tagRow = makeTag({ name: '采集' });
const link = (entityId: string, entityType: EntityTag['entityType']): EntityTag => ({
  ...tagRow,
  id: `link-${entityId}`,
  tagId: tagRow.id,
  entityType,
  entityId,
});

describe('全局搜索覆盖面', () => {
  const reference = makeReference({ title: '某篇 EMG 综述', noteFindings: '浮点权重映射到 int8 后精度只掉 1%。' });
  const task = makeTask({ title: '跑基线' });
  const project = makeProject({ name: '边缘部署预研' });
  const data = dataset({
    projects: [project],
    tasks: [task],
    references: [reference],
    tags: [tagRow],
    entityTags: [link(task.id, 'task'), link(reference.id, 'reference'), link(project.id, 'project')],
  });

  it('文献阅读笔记可以被搜到', () => {
    const hits = searchAll(data, 'int8');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ entityType: 'reference', id: reference.id });
    expect(hits[0].matchedFields).toContain('笔记');
  });

  it('标签名能带出挂了它的所有实体', () => {
    const hits = searchAll(data, '采集');
    expect(hits.map((h) => h.entityType).sort()).toEqual(['project', 'reference', 'task']);
    expect(hits.every((h) => h.matchedFields.includes('标签'))).toBe(true);
  });

  it('软删除与空查询不产生结果', () => {
    expect(searchAll(data, '')).toHaveLength(0);
    expect(searchAll(dataset({ references: [makeReference({ title: '删除的', deletedAt: 1 })] }), '删除的')).toHaveLength(0);
  });
});
