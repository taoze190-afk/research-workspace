import type { Dataset, EntityType } from './types';

export interface SearchHit {
  id: string;
  entityType: EntityType;
  title: string;
  context: string;
  href: string;
  matchedFields: string[];
}

export const entityTypeLabels: Record<EntityType, string> = {
  project: '项目',
  task: '任务',
  experiment: '实验',
  reference: '文献',
};

/** 中文没有词边界，所以只做「小写 + 连续空白折叠」后的子串匹配。 */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

interface Field {
  label: string;
  value: string;
}

function snippet(text: string, query: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const idx = clean.toLowerCase().indexOf(query);
  if (idx < 0) return clean.slice(0, 60);
  const start = Math.max(0, idx - 18);
  const end = start + 76;
  return `${start > 0 ? '…' : ''}${clean.slice(start, end)}${clean.length > end ? '…' : ''}`;
}

function matchFields(fields: Field[], query: string): Field[] {
  return fields.filter((f) => f.value && normalizeText(f.value).includes(query));
}

function buildHit(
  entityType: EntityType,
  id: string,
  href: string,
  fields: Field[],
  query: string
): SearchHit | null {
  const matched = matchFields(fields, query);
  if (matched.length === 0) return null;
  const titleField = fields[0];
  const contextField = matched.find((f) => f !== titleField) ?? titleField;
  return {
    id,
    entityType,
    title: titleField.value.trim() || '未命名',
    context: contextField === titleField ? '' : snippet(contextField.value, query),
    href,
    matchedFields: matched.map((f) => f.label),
  };
}

/** 每个实体的标签名拼成一个可搜索字段；标签恰恰是「记得标签、忘了标题」时的入口。 */
function tagField(data: Dataset, entityType: EntityType, entityId: string): Field | null {
  const nameById = new Map(data.tags.map((t) => [t.id, t.name]));
  const names: string[] = [];
  for (const et of data.entityTags) {
    if (et.deletedAt !== null || et.entityType !== entityType || et.entityId !== entityId) continue;
    const name = nameById.get(et.tagId);
    if (name) names.push(name);
  }
  return names.length ? { label: '标签', value: names.join(' ') } : null;
}

export function searchAll(data: Dataset, query: string): SearchHit[] {
  const q = normalizeText(query);
  if (!q) return [];
  const hits: SearchHit[] = [];

  for (const p of data.projects) {
    if (p.deletedAt) continue;
    const h = buildHit('project', p.id, `/projects/${p.id}`, [
      { label: '名称', value: p.name },
      { label: '目标', value: p.goal },
      { label: '研究问题', value: p.question },
      tagField(data, 'project', p.id),
    ].filter(Boolean) as Field[], q);
    if (h) hits.push(h);
  }

  for (const t of data.tasks) {
    if (t.deletedAt) continue;
    const h = buildHit('task', t.id, `/tasks?focus=${encodeURIComponent(t.id)}`, [
      { label: '标题', value: t.title },
      { label: '描述', value: t.description },
      tagField(data, 'task', t.id),
    ].filter(Boolean) as Field[], q);
    if (h) hits.push(h);
  }

  for (const e of data.experiments) {
    if (e.deletedAt) continue;
    const body = [e.purpose, e.hypothesis, e.method, e.results, e.observations, e.conclusion, e.nextStep].join('\n\n');
    const h = buildHit('experiment', e.id, `/experiments/${e.id}`, [
      { label: '标题', value: e.title },
      { label: '正文', value: body },
      tagField(data, 'experiment', e.id),
    ].filter(Boolean) as Field[], q);
    if (h) hits.push(h);
  }

  for (const r of data.references) {
    if (r.deletedAt) continue;
    const notes = [r.noteQuestion, r.noteMethod, r.noteFindings, r.noteLimits, r.noteRelevance].join('\n\n');
    const h = buildHit('reference', r.id, `/library?focus=${encodeURIComponent(r.id)}`, [
      { label: '标题', value: r.title },
      { label: '作者', value: r.authors },
      { label: '出处', value: r.venue },
      { label: '笔记', value: notes },
      tagField(data, 'reference', r.id),
    ].filter(Boolean) as Field[], q);
    if (h) hits.push(h);
  }

  return hits;
}
