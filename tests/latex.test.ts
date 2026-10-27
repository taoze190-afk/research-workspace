import { describe, expect, it } from 'vitest';
import { experimentsToLatexTable } from '@/features/experiments/export';

describe('LaTeX 表格导出', () => {
  it('转义 LaTeX 特殊字符', () => {
    const latex = experimentsToLatexTable([{ title: 'a_1 & b', model: 'YOLO\\v2', params: 'lr=0.01 % 基准', metrics: 'm^2', status: '已完成' }]);
    expect(latex).toContain('a\\_1 \\& b');
    expect(latex).toContain('YOLO\\textbackslash{}v2');
    expect(latex).toContain('lr=0.01 \\% 基准');
    expect(latex).toContain('m\\textasciicircum{}2');
  });

  it('行数与列数对齐，空字段补 —', () => {
    const latex = experimentsToLatexTable([
      { title: '基线', model: 'M1', params: '', metrics: 'mAP=0.5', status: '已完成' },
      { title: '消融', model: '', params: 'p=1', metrics: '', status: '失败' },
    ]);
    const rows = latex.split('\n').filter((l) => l.endsWith('\\\\'));
    expect(rows).toHaveLength(3); // 表头 + 两行
    expect(rows[1].split('&')).toHaveLength(5);
    expect(rows[2]).toContain('& — &');
  });
});
