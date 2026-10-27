import { describe, expect, it } from 'vitest';
import { db } from '@/data/db';
import { loadDataset } from '@/data/repo';
import { applyImport, buildBackup, parseBackupJson, planImport } from '@/lib/backup';
import { findDuplicate, normalizeDoi } from '@/domain/dedupe';
import { makeReference } from './factory';

describe('DOI 规范化与判重', () => {
  it('三种写法归一到同一个键', () => {
    const a = normalizeDoi('https://doi.org/10.1109/TBME.2024.000');
    const b = normalizeDoi('DOI: 10.1109/tbme.2024.000');
    const c = normalizeDoi(' 10.1109/TBME.2024.000 ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('有 DOI 时按 DOI 判成确定重复', () => {
    const existing = makeReference({ title: '甲研究', doi: '10.1/ABC', year: 2020 });
    const match = findDuplicate({ doi: 'https://doi.org/10.1/abc', title: '完全不同的标题', year: 1999 }, [existing]);
    expect(match.kind).toBe('doi');
    expect(match.existing?.id).toBe(existing.id);
  });

  it('没有 DOI 时标题加年份只给疑似', () => {
    const existing = makeReference({ title: '表面肌电握姿分类', authors: '张三', year: 2024, doi: '' });
    const same = findDuplicate({ title: '表面肌电握姿分类', year: 2024, doi: '' }, [existing]);
    expect(same.kind).toBe('title-year');
    const otherYear = findDuplicate({ title: '表面肌电握姿分类', year: 2025, doi: '' }, [existing]);
    expect(otherYear.kind).toBeNull();
    expect(otherYear.existing).toBeNull();
  });

  it('软删除的条目不再当作重复对象', () => {
    const dead = makeReference({ title: '旧记录', doi: '10.2/x', deletedAt: 1 });
    expect(findDuplicate({ doi: '10.2/x' }, [dead]).existing).toBeNull();
  });
});

describe('备份解析', () => {
  it('非法 JSON 给出人话错误', () => {
    const result = parseBackupJson('{ 这不是 json');
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('合法 JSON');
  });

  it('未知 schemaVersion 直接拒绝', () => {
    const file = { app: 'research-workspace', schemaVersion: 99, exportedAt: 'x', data: {} };
    const result = parseBackupJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('不支持的数据版本 v99');
  });

  it('结构缺字段时指出具体路径', () => {
    const file = { app: 'research-workspace', schemaVersion: 1, exportedAt: 'x', data: { projects: [{ id: 'p1', name: '缺状态' }] } };
    const result = parseBackupJson(JSON.stringify(file));
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain('projects');
  });
});

async function seed() {
  const data = await loadDataset();
  return data;
}

describe('备份往返', () => {
  it('导出后写进一个空库，实体数量、内容与关系一致', async () => {
    await db.projects.add({ id: 'p1', name: '采集装置', question: '能不能分六类', goal: '识别率 90%', status: 'active', startDate: null, endDate: null, favorite: true, createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.tasks.add({ id: 't1', title: '重测 3 号', description: '', status: 'doing', priority: 'high', dueDate: '2026-10-23', projectId: 'p1', sourceExperimentId: 'e1', referenceId: null, completedAt: null, recurrence: 'none', createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.subtasks.add({ id: 's1', taskId: 't1', title: '补一张示意图', done: false, sortOrder: 0, createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.experiments.add({ id: 'e1', title: '台架基线', experimentDate: '2026-10-20', projectId: 'p1', status: 'done', purpose: '拿 MVC', hypothesis: '', dataSources: [{ id: 'd1', kind: 'path', label: 'D:/data' }], method: '', results: '', observations: '', conclusion: '', nextStep: '', repoUrl: '', commit: '', sourceExperimentId: null, createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.references.add({ ...makeReference({ id: 'r1', title: '一篇文献', doi: '10.3/x' }) });
    await db.projectReferences.add({ id: 'l1', projectId: 'p1', referenceId: 'r1', createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.tags.add({ id: 'g1', name: '采集', createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });
    await db.entityTags.add({ id: 'et1', tagId: 'g1', entityType: 'experiment', entityId: 'e1', createdAt: 10, updatedAt: 20, deletedAt: null, isDemo: false });

    const before = await seed();
    const json = JSON.stringify(buildBackup(before));

    // 模拟「另一台设备的干净浏览器」：清空后按空库导入
    for (const table of db.tables) await table.clear();
    const empty = await seed();
    expect(empty.projects).toHaveLength(0);

    const parsed = parseBackupJson(json);
    expect(parsed.ok).toBe(true);
    const plan = planImport(parsed.file!, empty, 'merge');
    expect(plan.blockers).toEqual([]);
    expect(plan.toAdd).toBe(8);
    await applyImport(parsed.file!, plan);

    const after = await seed();
    // 结构相等（不看键顺序）：数量、内容、关系都必须一致
    expect(after).toEqual(before);
    expect(after.tasks[0].sourceExperimentId).toBe('e1');
    expect(after.projectReferences[0].referenceId).toBe('r1');
  });

  it('文件内部重复 ID 会被拒绝，已有数据不动', async () => {
    await db.projects.add({ id: 'keep', name: '原有项目', question: '', goal: '', status: 'planned', startDate: null, endDate: null, favorite: false, createdAt: 1, updatedAt: 1, deletedAt: null, isDemo: false });
    const current = await seed();
    const bad = {
      app: 'research-workspace',
      schemaVersion: 1,
      exportedAt: 'x',
      data: {
        ...current,
        projects: [
          { ...current.projects[0], id: 'dup', name: 'A' },
          { ...current.projects[0], id: 'dup', name: 'B' },
        ],
      },
    };
    const parsed = parseBackupJson(JSON.stringify(bad));
    expect(parsed.ok).toBe(true);
    const plan = planImport(parsed.file!, current, 'merge');
    expect(plan.blockers.join()).toContain('重复 ID');
    await expect(applyImport(parsed.file!, plan)).rejects.toThrow(/重复 ID/);
    expect(await db.projects.get('keep')).toBeDefined();
    expect(await db.projects.get('dup')).toBeUndefined();
  });

  it('里程碑指向不存在的项目属于阻断错误', async () => {
    const current = await seed();
    const file = {
      app: 'research-workspace',
      schemaVersion: 1,
      exportedAt: 'x',
      data: { ...current, milestones: [{ id: 'm1', projectId: 'ghost', title: '孤儿子', done: false, dueDate: null, sortOrder: 0, createdAt: 1, updatedAt: 1, deletedAt: null, isDemo: false }] },
    };
    const parsed = parseBackupJson(JSON.stringify(file));
    const plan = planImport(parsed.file!, current, 'merge');
    expect(plan.blockers.join()).toContain('关联完整性');
  });

  it('任务指向不存在的项目只警告并退回未关联，不阻断导入', async () => {
    const current = await seed();
    const file = {
      app: 'research-workspace',
      schemaVersion: 1,
      exportedAt: 'x',
      data: { ...current, tasks: [{ id: 't-ghost', title: '孤儿任务', description: '', status: 'todo', priority: 'low', dueDate: null, projectId: 'nope', sourceExperimentId: null, completedAt: null, createdAt: 1, updatedAt: 1, deletedAt: null, isDemo: false }] },
    };
    const parsed = parseBackupJson(JSON.stringify(file));
    const plan = planImport(parsed.file!, current, 'merge');
    expect(plan.blockers).toEqual([]);
    expect(plan.detachWarnings.join()).toContain('退回未关联');
    const outcome = await applyImport(parsed.file!, plan);
    expect(outcome.detached).toBe(1);
    expect((await db.tasks.get('t-ghost'))?.projectId).toBeNull();
  });

  it('合并时按 updatedAt 取较新的一份，不无脑覆盖', async () => {
    await db.projects.add({ id: 'p1', name: '本地更新版', question: '', goal: '', status: 'active', startDate: null, endDate: null, favorite: false, createdAt: 1, updatedAt: 500, deletedAt: null, isDemo: false });
    const current = await seed();
    const older = {
      app: 'research-workspace',
      schemaVersion: 1,
      exportedAt: 'x',
      data: { ...current, projects: [{ ...current.projects[0], name: '备份里的旧版', updatedAt: 100 }] },
    };
    const parsed = parseBackupJson(JSON.stringify(older));
    const plan = planImport(parsed.file!, current, 'merge');
    expect(plan.toUpdate).toBe(0);
    expect(plan.unchanged).toBe(1);
    await applyImport(parsed.file!, plan);
    expect((await db.projects.get('p1'))?.name).toBe('本地更新版');
  });

  it('替换模式先清库再写入，条数完全等于备份', async () => {
    await db.projects.add({ id: 'local', name: '本地独有', question: '', goal: '', status: 'planned', startDate: null, endDate: null, favorite: false, createdAt: 1, updatedAt: 1, deletedAt: null, isDemo: false });
    const current = await seed();
    const file = buildBackup({ ...current, projects: current.projects.filter((p) => p.id !== 'local') });
    const json = JSON.stringify(file);
    const parsed = parseBackupJson(json);
    const plan = planImport(parsed.file!, await seed(), 'replace');
    expect(plan.mode).toBe('replace');
    await applyImport(parsed.file!, plan);
    expect(await db.projects.get('local')).toBeUndefined();
    expect(await seed()).toEqual(parsed.file!.data);
  });
});
