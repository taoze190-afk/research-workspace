import { db } from './db';
import { newBase } from '@/lib/id';
import { addDays, localToday } from '@/domain/date';
import { getPrefs, setPrefs } from '@/lib/prefs';
import type { EntityTag, Experiment, Milestone, Project, ProjectReference, Reference, Subtask, Tag, Task } from '@/domain/types';

/**
 * 演示数据全部带 isDemo=true，日期按首次加载当天生成。
 * 文献条目是「演示条目」：标题、作者、结论都是编造的占位内容，DOI 一律留空，
 * 避免出现看起来真实却无法核实的元数据。
 */
export async function loadDemoData(): Promise<{ loaded: boolean; reason?: string }> {
  if (getPrefs().demoLoadedAt !== null) return { loaded: false, reason: '演示数据此前已加载过' };
  const already = await db.projects.filter((p) => p.isDemo).count();
  if (already > 0) {
    setPrefs({ demoLoadedAt: Date.now() });
    return { loaded: false, reason: '库里已有演示项目，未重复插入' };
  }

  const today = localToday();
  const demo = true;
  const base = (offsetMinutes: number) => {
    const now = Date.now() - offsetMinutes * 60_000;
    return { createdAt: now, updatedAt: now, deletedAt: null, isDemo: demo };
  };

  const pSqueeze = newBase(demo);
  const pGesture = newBase(demo);
  const pPaper = newBase(demo);
  const projects: Project[] = [
    {
      ...pSqueeze,
      name: '腕臂式肌电信号采集装置',
      question: '在桌面级腕臂结构上，8 通道 sEMG 能否稳定区分 6 类握姿？',
      goal: '搭起采集台架，拿到一套可用于训练的 6 类握姿数据，端到端识别率不低于 90%。',
      status: 'active',
      startDate: addDays(today, -34),
      endDate: addDays(today, 26),
      favorite: true,
    },
    {
      ...pGesture,
      name: '挥拍前肌电轨迹分析',
      question: '击球前 200ms 的肌肉激活顺序，能否作为动作质量的判别特征？',
      goal: '建立前肌电轨迹的特征提取流程，并在小样本上验证与前臂挥拍速度的相关性。',
      status: 'active',
      startDate: addDays(today, -12),
      endDate: addDays(today, 48),
      favorite: true,
    },
    {
      ...pPaper,
      name: '边缘推理部署预研',
      question: '现有分类模型压缩后能否在单片机级边缘设备上跑到实时？',
      goal: '完成量化与算子裁剪的可行性评估，输出一份算力与内存预算结论。',
      status: 'planned',
      startDate: addDays(today, -3),
      endDate: addDays(today, 90),
      favorite: false,
    },
  ];

  const milestones: Milestone[] = [
    { ...newBase(demo), projectId: pSqueeze.id, title: '完成电极贴放规范与阻抗测试', dueDate: addDays(today, -4), done: true, sortOrder: 0 },
    { ...newBase(demo), projectId: pSqueeze.id, title: '采满 10 名受试者各 6 类握姿', dueDate: addDays(today, 5), done: false, sortOrder: 1 },
    { ...newBase(demo), projectId: pSqueeze.id, title: '留出测试集并完成混淆矩阵', dueDate: addDays(today, 19), done: false, sortOrder: 2 },
    { ...newBase(demo), projectId: pGesture.id, title: '同步肌电与高速视频的时间戳对齐', dueDate: addDays(today, 2), done: false, sortOrder: 0 },
    { ...newBase(demo), projectId: pGesture.id, title: '写出前 200ms 包络特征提取脚本', dueDate: addDays(today, 14), done: false, sortOrder: 1 },
  ];

  const t = (
    id: { id: string },
    title: string,
    extra: Partial<Task> & { daysAgoDone?: number } = {}
  ): Task => ({
    ...base(60),
    id: id.id,
    title,
    description: '',
    status: extra.status ?? 'todo',
    priority: extra.priority ?? 'medium',
    dueDate: extra.dueDate ?? null,
    projectId: extra.projectId ?? null,
    sourceExperimentId: extra.sourceExperimentId ?? null,
    referenceId: extra.referenceId ?? null,
    recurrence: extra.recurrence ?? 'none',
    // 完成时间摊到最近几周，推进节奏图才有真实数据可看
    completedAt: extra.status === 'done' ? Date.now() - (extra.daysAgoDone ?? 1) * 86400000 : null,
  });

  const ids = () => newBase(demo);
  const expA = ids();
  const expB = ids();
  const expC = ids();
  const expD = ids();

  const tasks: Task[] = [
    t(ids(), '把电极阻抗测试记录补进实验 A', { projectId: pSqueeze.id, status: 'todo', priority: 'urgent', dueDate: today }),
    t(ids(), '重跑 5 号受试者缺失的两段数据', { projectId: pSqueeze.id, status: 'todo', priority: 'high', dueDate: today }),
    t(ids(), '整理握姿标注规范给师弟看', { projectId: pSqueeze.id, status: 'doing', priority: 'medium', dueDate: addDays(today, 1) }),
    t(ids(), '写特征提取脚本的第二版', { projectId: pGesture.id, status: 'todo', priority: 'high', dueDate: addDays(today, 3) }),
    t(ids(), '核对挥拍视频与肌电的时间偏移', { projectId: pGesture.id, status: 'doing', priority: 'urgent', dueDate: addDays(today, 2) }),
    t(ids(), '给采集固件加上掉电续传', { projectId: pSqueeze.id, status: 'todo', priority: 'medium', dueDate: addDays(today, 6) }),
    t(ids(), '读演示条目 3 并写局限笔记', { projectId: pGesture.id, status: 'todo', priority: 'low', dueDate: addDays(today, 5) }),
    t(ids(), '估计量化后模型占用的内存', { projectId: pPaper.id, status: 'todo', priority: 'medium', dueDate: addDays(today, 7) }),
    t(ids(), '标定 6 类握姿的静息阈值', { projectId: pSqueeze.id, status: 'done', priority: 'high', dueDate: addDays(today, -1), daysAgoDone: 2 }),
    t(ids(), '完成台架走线整改', { projectId: pSqueeze.id, status: 'done', priority: 'medium', dueDate: addDays(today, -6), daysAgoDone: 9 }),
    t(ids(), '起草边缘部署评估表', { projectId: pPaper.id, status: 'done', priority: 'low', dueDate: addDays(today, -2), daysAgoDone: 16 }),
    t(ids(), '复现上一版的时域特征基线', { projectId: pGesture.id, status: 'done', priority: 'medium', dueDate: addDays(today, -8), daysAgoDone: 24 }),
    t(ids(), '采购第二块放大板', { projectId: pSqueeze.id, status: 'cancelled', priority: 'low', dueDate: null }),
    t(ids(), '跟进：受试者知情同意书归档', { projectId: null, status: 'todo', priority: 'high', dueDate: addDays(today, -3) }),
  ];

  const subtasks: Subtask[] = [
    { ...newBase(demo), taskId: tasks[2].id, title: '列出 6 类握姿的定义', done: true, sortOrder: 0 },
    { ...newBase(demo), taskId: tasks[2].id, title: '补一张贴法示意图', done: false, sortOrder: 1 },
    { ...newBase(demo), taskId: tasks[3].id, title: '按通道分组求包络', done: false, sortOrder: 0 },
  ];

  const experiment = (
    id: { id: string },
    title: string,
    projectId: string,
    status: Experiment['status'],
    fields: Partial<Experiment>
  ): Experiment => ({
    ...emptyDemoExperiment(),
    ...id,
    ...base(120),
    title,
    experimentDate: fields.experimentDate ?? addDays(today, -2),
    projectId,
    status,
    ...fields,
  });

  const experiments: Experiment[] = [
    experiment(expA, '台架基线：静息与最大自主收缩', pSqueeze.id, 'done', {
      purpose: '拿到每位受试者的静息电平与 MVC，用于后续归一化。',
      hypothesis: '同一受试者隔天 MVC 波动应控制在 10% 以内。',
      dataSources: [
        { id: 'ds-a1', kind: 'path', label: 'D:/data/squeeze/baseline_0510/' },
        { id: 'ds-a2', kind: 'version', label: 'raw-v1 / 12 段 30s' },
      ],
      method: '1. 贴 8 通道电极，静息坐位 60s\n2. 三次 5s 握拳 MVC，间隔 30s\n3. 采样率 1kHz，带通 20–450Hz',
      results: '10 名受试者全部完成；隔天 MVC 波动中位数 7.4%。',
      observations: '3 号受试者第 2 次 MVC 有明显抖动，怀疑电极松动。\n异常：5 号通道在最后一次采集出现 50Hz 工频干扰。',
      conclusion: '归一化按个体 MVC 走，不用组内均值。',
      nextStep: '把电极松动这条写进采集规范，重测 3 号。',
      repoUrl: '',
      commit: '',
    }),
    experiment(expB, '6 类握姿采集（第 1 批）', pSqueeze.id, 'active', {
      purpose: '采集第一批 6 类握姿数据，检查每类动作的可分性。',
      hypothesis: '握拳与捏取在前 150ms 的通道激活顺序上应能区分。',
      dataSources: [{ id: 'ds-b1', kind: 'path', label: 'D:/data/squeeze/batch01/' }],
      method: '每类动作 10 次，随机顺序，动作间休息 5s。',
      results: '完成 5 人，握拳/捏取两类时间波形高度相似。',
      observations: '异常：4 号受试者的「伸展」有明显代偿，肩部参与。',
      conclusion: '',
      nextStep: '重采 4 号的伸展类，并考虑加通道。',
    }),
    experiment(expC, '视频与肌电时间戳对齐验证', pGesture.id, 'done', {
      purpose: '确认高速视频帧与肌电样本之间的偏移量能稳定估计。',
      hypothesis: '用击球闪光作为共同事件，对齐误差可压到 4ms 以内。',
      dataSources: [
        { id: 'ds-c1', kind: 'link', label: '实验室共享盘 / tennis/sync/' },
        { id: 'ds-c2', kind: 'version', label: 'sync-tool @ 2026-09 版' },
      ],
      method: '同步录制 8 段，人工标出击球瞬间，比较两路事件差。',
      results: '8 段对齐误差中位数 3.1ms，最大 6.7ms。',
      conclusion: '对齐方案可用，写进正式采集流程。',
      repoUrl: '内网仓库（手动记录，未读取文件）',
      commit: 'a19c3f2',
    }),
    experiment(expD, '前 200ms 包络特征试算', pGesture.id, 'draft', {
      purpose: '试一版包络均值与斜率特征，看是否已带判别力。',
      method: '对 12 段有效数据求 4 通道包络，取前 200ms 统计量。',
      results: '',
      nextStep: '补一个最简单的两类可分性检查。',
    }),
  ];

  // 让「下一步」在演示里真的连到任务
  const fromExpTask = t(ids(), '重采 4 号受试者的伸展类动作', {
    projectId: pSqueeze.id,
    status: 'todo',
    priority: 'high',
    dueDate: addDays(today, 4),
    sourceExperimentId: expB.id,
  });
  fromExpTask.description = `来源实验：${experiments[1].title}`;
  tasks.push(fromExpTask);

  const references: Reference[] = [
    demoRef('演示条目：高密度表面肌电握姿分类的通道选择方法', '李默，王秩', 2023, '示例学报（演示条目）', 'read', pSqueeze.id, {
      noteQuestion: '如何从 16 通道里挑出信息量最大的 8 通道。',
      noteMethod: '用互信息排序后做逐步回归。',
      noteFindings: '8 通道能保留 16 通道约 94% 的判别力。',
      noteLimits: '只测了 5 名受试者，没跨天验证。',
      noteRelevance: '可作为我这边通道裁剪的对照思路，但样本量太小。',
    }),
    demoRef('演示条目：前臂肌肉激活顺序与动作质量的关联', '陈序', 2022, '示例运动科学（演示条目）', 'reading', pGesture.id, {
      noteQuestion: '击球前的激活顺序是否比峰值幅值更稳定。',
      noteFindings: '顺序特征在个体内的变异系数更低。',
      noteRelevance: '直接对应我的前肌电轨迹假设。',
    }),
    demoRef('演示条目：肌电信号工频干扰的抑制实践', '赵一鸣，刘蕙', 2024, '示例仪器与仪表（演示条目）', 'unread', pSqueeze.id, {}),
    demoRef('演示条目：单片机上的定点量化推理预算', '孙舟', 2021, '示例嵌入式系统（演示条目）', 'unread', pPaper.id, {
      noteMethod: '把浮点权重映射到 int8，并测每层内存占用。',
    }),
    demoRef('演示条目：sEMG 数据集的可复现性评估', '周衡，吴迪', 2020, '示例生物医学工程（演示条目）', 'read', pSqueeze.id, {
      noteLimits: '公开数据普遍缺少电极位置记录。',
      noteRelevance: '提醒我把贴法写进实验记录。',
    }),
    demoRef('演示条目：动作准备期肌电基线的估计方法', '郑也', 2025, '示例人因工程（演示条目）', 'unread', pGesture.id, {}),
  ];

  const refTags: EntityTag[] = [];
  const tagRows: Tag[] = [];
  const tagNames = ['采集', '标注', '特征', '量化', '待复现'];
  for (const name of tagNames) tagRows.push({ ...newBase(demo), id: `demo-tag-${tagNames.indexOf(name)}`, name });

  const pushTag = (entityType: EntityTag['entityType'], entityId: string, names: string[]) => {
    names.forEach((n, i) => {
      const tag = tagRows.find((t2) => t2.name === n);
      if (!tag) return;
      refTags.push({ ...newBase(demo), id: `demo-rel-${entityType}-${entityId}-${i}`, tagId: tag.id, entityType, entityId });
    });
  };

  pushTag('project', pSqueeze.id, ['采集', '标注']);
  pushTag('project', pGesture.id, ['特征']);
  pushTag('project', pPaper.id, ['量化']);
  pushTag('experiment', expA.id, ['采集']);
  pushTag('experiment', expB.id, ['采集', '待复现']);
  pushTag('experiment', expC.id, ['标注']);
  references.forEach((r, i) => pushTag('reference', r.id, i % 2 === 0 ? ['待复现'] : ['特征']));

  const projectReferences: ProjectReference[] = [];
  // 第 1 条文献同时服务两个项目，用来演示「一篇文献可关联多个项目」
  const links: Array<[Reference, string]> = [
    [references[0], pSqueeze.id],
    [references[0], pGesture.id],
    [references[1], pGesture.id],
    [references[2], pSqueeze.id],
    [references[3], pPaper.id],
    [references[4], pSqueeze.id],
    [references[5], pGesture.id],
  ];
  links.forEach(([ref, projectId], i) => {
    projectReferences.push({ ...newBase(demo), id: `demo-link-${i}`, projectId, referenceId: ref.id });
  });

  await db.transaction('rw', db.tables, async () => {
    await db.projects.bulkAdd(projects);
    await db.milestones.bulkAdd(milestones);
    await db.tasks.bulkAdd(tasks);
    await db.subtasks.bulkAdd(subtasks);
    await db.experiments.bulkAdd(experiments);
    await db.references.bulkAdd(references);
    await db.tags.bulkAdd(tagRows);
    await db.entityTags.bulkAdd(refTags);
    await db.projectReferences.bulkAdd(projectReferences);
  });

  setPrefs({ demoLoadedAt: Date.now() });
  return { loaded: true };
}

function emptyDemoExperiment(): Experiment {
  return {
    ...newBase(true),
    title: '',
    experimentDate: localToday(),
    projectId: null,
    status: 'draft',
    purpose: '',
    hypothesis: '',
    dataSources: [],
    method: '',
    results: '',
    observations: '',
    conclusion: '',
    nextStep: '',
    repoUrl: '',
    commit: '',
    sourceExperimentId: null,
  };
}

function demoRef(
  title: string,
  authors: string,
  year: number,
  venue: string,
  readingStatus: Reference['readingStatus'],
  _projectId: string,
  notes: Partial<Reference>
): Reference {
  return {
    ...emptyDemoReference(),
    title,
    authors,
    year,
    venue,
    readingStatus,
    ...notes,
  };
}

function emptyDemoReference(): Reference {
  return {
    ...newBase(true),
    title: '',
    authors: '',
    year: null,
    venue: '',
    doi: '',
    url: '',
    readingStatus: 'unread',
    favorite: false,
    noteQuestion: '',
    noteMethod: '',
    noteFindings: '',
    noteLimits: '',
    noteRelevance: '',
  };
}
