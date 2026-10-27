import type { ResearchFileMetadata } from './repository';
import { MAX_AI_ATTACHMENTS } from '@/lib/ai-attachments';

export type FileCategory = 'document' | 'image' | 'data' | 'other';
export const FILE_CATEGORIES = [
  { value: '', label: '全部文件' },
  { value: 'document', label: '文档' },
  { value: 'image', label: '图片' },
  { value: 'data', label: '数据与代码' },
  { value: 'other', label: '其他' },
] as const;

export function filesAiHref(files: ResearchFileMetadata[]) {
  const selected = [...new Map(files.map((f) => [f.id, f])).values()];
  if (!selected.length || selected.length > MAX_AI_ATTACHMENTS)
    throw new Error('每次可选择 1–' + MAX_AI_ATTACHMENTS + ' 个文件交给 AI');
  const commonProject =
    selected[0].projectId && selected.every((f) => f.projectId === selected[0].projectId)
      ? selected[0].projectId
      : null;
  const params = new URLSearchParams({
    scope: commonProject ? 'project:' + commonProject : 'workspace',
    workflow: 'file-analysis',
  });
  selected.forEach((file) => params.append('file', file.id));
  return '/ai?' + params;
}

export function incomingFileIds(params: URLSearchParams) {
  return [
    ...new Set(
      params
        .getAll('file')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
}

export function fileCategory(file: Pick<ResearchFileMetadata, 'name' | 'mimeType'>): FileCategory {
  const extension = file.name.split('.').at(-1)?.toLowerCase() || '';
  if (file.mimeType.startsWith('image/') || /^(png|jpe?g|webp|gif|svg|tiff?|bmp|avif)$/.test(extension)) return 'image';
  if (
    /^(csv|tsv|jsonl?|xlsx?|parquet|ipynb|py|r|js|jsx|ts|tsx|c|cpp|h|hpp|sql|yaml|yml|toml|xml|html|css)$/.test(
      extension,
    )
  )
    return 'data';
  if (
    /^(pdf|docx?|pptx?|txt|md|markdown|tex|bib|rtf|odt)$/.test(extension) ||
    /pdf|document|presentation/.test(file.mimeType) ||
    file.mimeType.startsWith('text/')
  )
    return 'document';
  return 'other';
}

export function filterResearchFiles(
  files: ResearchFileMetadata[],
  options: { query?: string; project?: string; category?: string; sort?: string },
) {
  const query = options.query?.trim().toLocaleLowerCase() || '';
  return files
    .filter(
      (file) =>
        !options.project || (options.project === '__none' ? !file.projectId : file.projectId === options.project),
    )
    .filter((file) => !options.category || fileCategory(file) === options.category)
    .filter((file) => !query || file.name.toLocaleLowerCase().includes(query))
    .sort((a, b) => {
      const byName = a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
      if (options.sort === 'name') return byName || a.id.localeCompare(b.id);
      if (options.sort === 'size') return b.size - a.size || byName;
      return b.updatedAt - a.updatedAt || byName;
    });
}
