import { createExperiment, createProject, createReference, createTask, linkReferenceProject, setEntityTags } from '@/data/repo';
import { addDays, localToday } from '@/domain/date';
import { createId } from '@/lib/id';

/**
 * 示例模板：给空库一个「像样的起点」，两条常见科研路径各一份。
 * 记录全部带 isDemo 标记，设置页的「清除演示数据」可以整体撤掉。
 */

const src = (kind: 'model' | 'param' | 'metric' | 'path', label: string) => ({ id: createId(), kind, label });

/** 目标检测论文复现：项目 + 两条带结构化参数的实验 + 任务 + 关联文献。 */
export async function loadReplicationTemplate(): Promise<void> {
  const today = localToday();
  const project = await createProject({
    name: '目标检测论文复现',
    question: '论文报告的 mAP 能否在相同数据划分下复现到 ±1%？',
    goal: '跑通官方代码，复现主表与消融实验，整理一份可迁移的复现笔记',
    status: 'active',
    isDemo: true,
  });

  const paper = await createReference({
    title: '示例论文：YOLO-Repro 目标检测基线',
    authors: 'Wang L；Chen H',
    year: 2025,
    venue: 'CVPR Proceedings',
    readingStatus: 'reading',
    isDemo: true,
  });
  const tips = await createReference({
    title: '示例文献：检测模型训练技巧综述',
    authors: 'Liu X',
    year: 2024,
    venue: '示例期刊',
    readingStatus: 'unread',
    isDemo: true,
  });
  await linkReferenceProject(paper.id, project.id, true);
  await linkReferenceProject(tips.id, project.id, true);

  const exp1 = await createExperiment({
    title: '基线复现：COCO 子集训练',
    projectId: project.id,
    status: 'done',
    experimentDate: addDays(today, -6),
    purpose: '验证官方训练流程在本机可复现',
    hypothesis: '相同超参下 mAP 与论文差距 < 1%',
    method: '1. 克隆官方仓库并装依赖\n2. 取 COCO 子集 5k 图\n3. SGD lr=0.01，50 epoch',
    results: 'mAP@0.5 = 0.512（论文 0.518）',
    observations: '第 30 epoch 后学习率衰减贡献了主要增益',
    conclusion: '差距 0.6%，在容差内，流程可复现',
    nextStep: '补齐数据增强后重跑一轮',
    dataSources: [src('model', 'YOLO-Repro-S'), src('param', 'lr=0.01 · epoch=50 · batch=16'), src('metric', 'mAP@0.5=0.512'), src('path', 'D:/data/coco-sub')],
    isDemo: true,
  });
  const exp2 = await createExperiment({
    title: '消融：数据增强对照',
    projectId: project.id,
    status: 'active',
    experimentDate: addDays(today, -1),
    purpose: '确认 MixUp 对小数据集的增益',
    hypothesis: '开启 MixUp 后 mAP 提升 1%',
    method: '固定其余超参，仅切换增强开关，各跑一次',
    results: '',
    observations: '训练中 loss 曲线更平滑',
    conclusion: '',
    nextStep: '跑完 50 epoch 后对齐主表',
    dataSources: [src('model', 'YOLO-Repro-S'), src('param', 'mixup=on · epoch=50'), src('metric', '训练中（待评估）')],
    isDemo: true,
  });

  await createTask({ title: '跑通官方代码与环境', projectId: project.id, status: 'done', dueDate: addDays(today, -6), priority: 'high', isDemo: true });
  await createTask({ title: '准备 COCO 子集数据', projectId: project.id, status: 'done', dueDate: addDays(today, -7), isDemo: true });
  await createTask({ title: '复现主表第 1 行', projectId: project.id, status: 'doing', dueDate: addDays(today, 1), priority: 'urgent', sourceExperimentId: exp2.id, isDemo: true });
  await createTask({ title: '写复现笔记：坑与解法', projectId: project.id, dueDate: addDays(today, 3), referenceId: paper.id, isDemo: true });
  await createTask({ title: '对齐消融表并截图', projectId: project.id, dueDate: addDays(today, 5), priority: 'low', isDemo: true });

  await setEntityTags('project', project.id, ['复现', '检测']);
  await setEntityTags('experiment', exp1.id, ['复现']);
}

/** 开题报告调研：文献驱动，阅读状态分布覆盖全流程。 */
export async function loadSurveyTemplate(): Promise<void> {
  const today = localToday();
  const project = await createProject({
    name: '开题报告调研',
    question: '肌电手势识别在边缘设备上的实时性瓶颈在哪？',
    goal: '梳理近三年方法谱系，确定自己的切入点，形成开题大纲',
    status: 'active',
    isDemo: true,
  });

  const core = await createReference({
    title: '示例文献：边缘端肌电手势识别综述',
    authors: '孙冉；郑也夫',
    year: 2025,
    venue: '示例嵌入式系统',
    readingStatus: 'read',
    noteQuestion: '边缘部署的主要瓶颈是算力还是功耗？',
    noteMethod: '按量化策略与模型结构两条线梳理 42 篇文献',
    noteFindings: 'int8 量化 + 通道剪枝组合是当前主流',
    noteLimits: '数据集规模普遍偏小，跨被试泛化存疑',
    noteRelevance: '我的切入点可以是量化感知训练与延迟的权衡',
    isDemo: true,
  });
  const b = await createReference({ title: '示例文献：轻量网络的通道剪枝方法', authors: '李默', year: 2024, venue: '示例学报', readingStatus: 'reading', isDemo: true });
  const c = await createReference({ title: '示例文献：跨被试肌电的域自适应', authors: '陈序', year: 2023, venue: '示例生物医学工程', readingStatus: 'unread', isDemo: true });
  const d = await createReference({ title: '示例文献：端侧推理引擎的延迟剖析', authors: '赵一鸣', year: 2024, venue: '示例仪器与仪表', readingStatus: 'unread', isDemo: true });
  for (const r of [core, b, c, d]) await linkReferenceProject(r.id, project.id, true);

  await createTask({ title: '精读核心综述并写周记', projectId: project.id, status: 'doing', dueDate: addDays(today, 2), priority: 'high', referenceId: core.id, isDemo: true });
  await createTask({ title: '整理方法对比表', projectId: project.id, dueDate: addDays(today, 4), referenceId: b.id, isDemo: true });
  await createTask({ title: '列出候选研究问题清单', projectId: project.id, dueDate: addDays(today, 6), priority: 'medium', isDemo: true });
  await createTask({ title: '和导师过一遍开题大纲', projectId: project.id, dueDate: addDays(today, 9), priority: 'low', isDemo: true });

  await setEntityTags('project', project.id, ['调研', '开题']);
  await setEntityTags('reference', core.id, ['综述']);
}
