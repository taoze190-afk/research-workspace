import type { Dataset, Experiment } from '@/domain/types';
import { experimentStatusLabels } from '@/domain/types';
import { formatDate } from '@/domain/date';
import { entityTags } from '@/domain/progress';

const block = (label: string, text: string) => (text.trim() ? `## ${label}\n\n${text.trim()}\n` : '');

// ---------------------------------------------------------------- LaTeX 表格导出

const escapeLatex = (text: string): string =>
  text
    .replace(/\\/g, '\u0000')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/\u0000/g, '\\textbackslash{}');

export interface LatexRow {
  title: string;
  model: string;
  params: string;
  metrics: string;
  status: string;
}

/** 选中实验 → LaTeX 表格源码，直接粘进论文（需 booktabs 宏包）。 */
export function experimentsToLatexTable(rows: LatexRow[]): string {
  const head = ['实验', '模型', '超参数', '指标', '状态'].join(' & ');
  const body = rows
    .map((r) =>
      [r.title, r.model || '—', r.params || '—', r.metrics || '—', r.status]
        .map((cell) => escapeLatex(cell).replace(/\s+/g, ' ').trim() || '—')
        .join(' & ')
    )
    .map((line) => `${line} \\\\`)
    .join('\n');
  return [
    '% 需要 booktabs 宏包：\\usepackage{booktabs}',
    '\\begin{table}[htbp]',
    '\\centering',
    '\\caption{实验参数与指标对比}',
    '\\begin{tabular}{lllll}',
    '\\toprule',
    `${head} \\\\`,
    '\\midrule',
    body,
    '\\bottomrule',
    '\\end{tabular}',
    '\\end{table}',
    '',
  ].join('\n');
}

export function experimentToMarkdown(exp: Experiment, data: Dataset): string {
  const project = data.projects.find((p) => p.id === exp.projectId);
  const source = data.experiments.find((e) => e.id === exp.sourceExperimentId);
  const tags = entityTags(data, 'experiment', exp.id);
  const lines: string[] = [`# ${exp.title || '未命名实验'}`, ''];

  lines.push(`- 日期：${formatDate(exp.experimentDate) || '未填'}`);
  lines.push(`- 状态：${experimentStatusLabels[exp.status]}`);
  lines.push(`- 所属项目：${project?.name ?? '未关联'}`);
  if (tags.length) lines.push(`- 标签：${tags.join('、')}`);
  if (source) lines.push(`- 复制自：${source.title || '未命名实验'}`);
  if (exp.repoUrl) lines.push(`- 代码仓库：${exp.repoUrl}`);
  if (exp.commit) lines.push(`- commit：${exp.commit}`);
  lines.push('');

  const parts = [
    block('研究目的', exp.purpose),
    block('假设', exp.hypothesis),
    exp.dataSources.length ? `## 数据或样本来源\n\n${exp.dataSources.map((d) => `- ${d.label}`).join('\n')}\n` : '',
    block('方法与步骤', exp.method),
    block('结果', exp.results),
    block('观察与异常', exp.observations),
    block('结论', exp.conclusion),
    block('下一步', exp.nextStep),
  ].filter(Boolean);

  return `${lines.join('\n')}\n${parts.join('\n')}`.trimEnd() + '\n';
}
