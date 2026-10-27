import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { FilesPage } from '@/features/files/FilesPage';
import type { ResearchFileMetadata } from '@/features/files/repository';
import { dataset, makeProject } from './factory';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  toast: vi.fn(),
  archive: vi.fn(),
  downloadArchive: vi.fn(),
}));
vi.mock('@/features/files/archive', () => ({
  buildResearchArchive: mocks.archive,
  downloadResearchArchive: mocks.downloadArchive,
}));
vi.mock('@/state/AuthContext', () => ({ useAuth: mocks.auth }));
vi.mock('@/state/DataContext', () => ({
  useData: () => ({ data: dataset({ projects: [makeProject({ id: 'p', name: '实验课题' })] }) }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/features/files/repository', async (original) => ({
  ...(await original<typeof import('@/features/files/repository')>()),
  listResearchFiles: mocks.list,
  saveResearchFile: mocks.save,
  readResearchFile: mocks.read,
  updateResearchFile: mocks.update,
  deleteResearchFile: mocks.remove,
  downloadResearchFile: mocks.download,
}));
const file: ResearchFileMetadata = {
  id: 'file-a',
  name: '实验笔记.txt',
  mimeType: 'text/plain',
  size: 5,
  sha256: 'h',
  projectId: 'p',
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ phase: 'local', user: null });
  mocks.list.mockResolvedValue({
    files: [file],
    usedBytes: 5,
    quotaBytes: 500 * 1024 * 1024,
    maxFileBytes: 25 * 1024 * 1024,
  });
  mocks.read.mockResolvedValue(new Blob(['笔记内容'], { type: 'text/plain' }));
  mocks.save.mockResolvedValue(file);
  mocks.update.mockResolvedValue(file);
  mocks.remove.mockResolvedValue(undefined);
  mocks.download.mockResolvedValue(undefined);
  mocks.archive.mockResolvedValue(new Blob(['zip']));
});
afterEach(cleanup);
const open = (route = '/files') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <FilesPage />
    </MemoryRouter>,
  );
describe('科研文件页面', () => {
  it('修改文件信息失败时在弹窗内显示错误并保留输入', async () => {
    mocks.update.mockRejectedValueOnce(new Error('测试元数据保存失败'));
    open('/files?focus=file-a');
    const detail = await screen.findByRole('dialog');
    fireEvent.click(within(detail).getByRole('button', { name: '重命名与关联' }));
    const editor = await screen.findByRole('dialog', { name: '文件信息' });
    fireEvent.change(within(editor).getByLabelText('文件名'), { target: { value: '修改后笔记.txt' } });
    fireEvent.click(within(editor).getByRole('button', { name: '保存' }));
    expect((await within(editor).findByRole('alert')).textContent).toContain('测试元数据保存失败');
    expect((within(editor).getByLabelText('文件名') as HTMLInputElement).value).toBe('修改后笔记.txt');
  });
  it('focus入口打开详情并提供下载与AI链接', async () => {
    open('/files?focus=file-a');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('笔记内容')).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: /交给 AI/ });
    const target = new URL(link.getAttribute('href')!, 'https://local.test');
    expect(target.searchParams.get('file')).toBe('file-a');
    expect(target.searchParams.get('scope')).toBe('project:p');
    fireEvent.click(within(dialog).getByRole('button', { name: '下载' }));
    expect(mocks.download).toHaveBeenCalledWith(file, { owner: 'local', mode: 'local' });
  });
  it('上传失败保留File对象，重试后仍使用原文件', async () => {
    mocks.save.mockRejectedValueOnce(new Error('测试连接失败'));
    open();
    await screen.findByRole('list', { name: '科研文件列表' });
    const selected = new File(['abc'], '待上传.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('上传科研文件'), { target: { files: [selected] } });
    expect(await screen.findByText('测试连接失败')).toBeTruthy();
    const queue = screen.getByRole('region', { name: '上传队列' });
    expect(within(queue).getByText('待上传.txt')).toBeTruthy();
    fireEvent.click(within(queue).getByRole('button', { name: '重试' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: '上传队列' })).toBeNull());
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.save.mock.calls[0][0]).toBe(selected);
    expect(mocks.save.mock.calls[1][0]).toBe(selected);
  });
  it('项目筛选入口生效，拖入文件沿用当前项目', async () => {
    open('/files?project=p');
    await screen.findByRole('list', { name: '科研文件列表' });
    const selected = new File(['data'], 'raw.csv', { type: 'text/csv' });
    fireEvent.drop(screen.getByTestId('file-drop-zone'), { dataTransfer: { files: [selected], types: ['Files'] } });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(selected, { owner: 'local', mode: 'local', projectId: 'p' }),
    );
    expect((screen.getByLabelText('按关联项目筛选文件') as HTMLSelectElement).value).toBe('p');
  });
  it('离线服务器账号不允许新增上传，明确显示存储归属', async () => {
    mocks.auth.mockReturnValue({ phase: 'offline', user: { id: 'user-a' } });
    open();
    await screen.findByRole('list', { name: '科研文件列表' });
    expect((screen.getByRole('button', { name: '上传文件' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/保存在当前账号/).textContent).toContain('离线中');
    expect(mocks.list).toHaveBeenCalledWith('user-a', 'server');
  });
  it('类型筛选与搜索、项目范围组合，清除后恢复完整列表', async () => {
    mocks.list.mockResolvedValue({
      files: [
        file,
        { ...file, id: 'data', name: '实验结果.csv', mimeType: 'text/csv' },
        { ...file, id: 'image', name: '实验图.png', mimeType: 'image/png', projectId: null },
      ],
      usedBytes: 15,
      quotaBytes: 100,
      maxFileBytes: 25,
    });
    open('/files?project=p&q=实验&type=data');
    const list = await screen.findByRole('list', { name: '科研文件列表' });
    expect(within(list).getByRole('button', { name: /^实验结果.csv/ })).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /实验笔记/ })).toBeNull();
    fireEvent.click(within(screen.getByRole('navigation', { name: '文件类型' })).getByRole('button', { name: /图片/ }));
    expect(await screen.findByText('没有匹配的文件')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(within(await screen.findByRole('list', { name: '科研文件列表' })).getAllByRole('listitem')).toHaveLength(3);
  });
  it('排序以用户选择生效，刷新列表保留筛选与排序', async () => {
    const rows = [
      { ...file, id: 'small', name: '小文件.txt', size: 5, updatedAt: 20 },
      { ...file, id: 'large', name: '大文件.txt', size: 500, updatedAt: 10 },
    ];
    mocks.list.mockResolvedValue({ files: rows, usedBytes: 505, quotaBytes: 1000, maxFileBytes: 25 });
    open('/files?project=p');
    const list = await screen.findByRole('list', { name: '科研文件列表' });
    expect(within(list).getAllByRole('listitem')[0].getAttribute('data-file-id')).toBe('small');
    fireEvent.change(screen.getByLabelText('文件排序'), { target: { value: 'size' } });
    expect(within(list).getAllByRole('listitem')[0].getAttribute('data-file-id')).toBe('large');
    fireEvent.click(screen.getByRole('button', { name: '刷新文件列表' }));
    const refreshed = await screen.findByRole('list', { name: '科研文件列表' });
    expect(within(refreshed).getAllByRole('listitem')[0].getAttribute('data-file-id')).toBe('large');
    expect((screen.getByLabelText('文件排序') as HTMLSelectElement).value).toBe('size');
    expect((screen.getByLabelText('按关联项目筛选文件') as HTMLSelectElement).value).toBe('p');
  });
  it('后台刷新保留原列表，避免界面闪空与焦点跳动', async () => {
    open();
    const list = await screen.findByRole('list', { name: '科研文件列表' });
    let finish!: (value: unknown) => void;
    mocks.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: '刷新文件列表' }));
    expect(list.isConnected).toBe(true);
    expect(list.getAttribute('aria-busy')).toBe('true');
    expect(within(list).getByText('实验笔记.txt')).toBeTruthy();
    finish({ files: [file], usedBytes: 5, quotaBytes: 500, maxFileBytes: 25 });
    await waitFor(() => expect(list.getAttribute('aria-busy')).toBe('false'));
  });
  it('多选只操作可见文件，切换筛选清除旧选择', async () => {
    const second = { ...file, id: 'image', name: '图.png', mimeType: 'image/png', projectId: null };
    mocks.list.mockResolvedValue({ files: [file, second], usedBytes: 10, quotaBytes: 500, maxFileBytes: 25 });
    open();
    await screen.findByRole('list', { name: '科研文件列表' });
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前列表全部文件' }));
    const actions = screen.getByRole('region', { name: '文件批量操作' });
    expect(within(actions).getByText('已选 2 个')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('搜索科研文件'), { target: { value: '笔记' } });
    expect(within(actions).getByText('已选 0 个')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前列表全部文件' }));
    fireEvent.click(within(actions).getByRole('button', { name: '打包下载' }));
    await waitFor(() => expect(mocks.archive).toHaveBeenCalled());
    expect(mocks.archive.mock.calls[0][0]).toEqual([file]);
    expect(mocks.archive.mock.calls[0][1]).toEqual({ owner: 'local', mode: 'local' });
  });
  it('批量关联部分失败时仅保留失败项，重试不重复更新成功项', async () => {
    const second = { ...file, id: 'second', name: '第二份.txt' };
    mocks.list.mockResolvedValue({ files: [file, second], usedBytes: 10, quotaBytes: 500, maxFileBytes: 25 });
    let failSecond = true;
    mocks.update.mockImplementation(async (id: string) => {
      if (id === 'second' && failSecond) {
        failSecond = false;
        throw new Error('暂时无法保存');
      }
      return id === 'second' ? second : file;
    });
    open();
    await screen.findByRole('list', { name: '科研文件列表' });
    fireEvent.click(screen.getByRole('button', { name: '多选' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前列表全部文件' }));
    fireEvent.click(
      within(screen.getByRole('region', { name: '文件批量操作' })).getByRole('button', { name: '关联项目' }),
    );
    const dialog = await screen.findByRole('dialog', { name: '批量关联项目' });
    fireEvent.change(within(dialog).getByLabelText('关联到项目'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: '保存关联' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('1 个失败');
    expect(within(dialog).getByText('第二份.txt')).toBeTruthy();
    expect(within(dialog).queryByText('实验笔记.txt')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: '重试失败项' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '批量关联项目' })).toBeNull());
    expect(mocks.update).toHaveBeenCalledTimes(3);
    expect(mocks.update.mock.calls[2]).toEqual(['second', { projectId: null }, { owner: 'local', mode: 'local' }]);
  });
  it('项目内文件页固定项目范围，上传自动关联且不能被URL的其他项目覆盖', async () => {
    mocks.list.mockResolvedValue({
      files: [file, { ...file, id: 'other', name: '其他项目.txt', projectId: 'other' }],
      usedBytes: 10,
      quotaBytes: 500,
      maxFileBytes: 25,
    });
    render(
      <MemoryRouter initialEntries={['/projects/p?tab=files&project=other']}>
        <FilesPage projectId="p" embedded />
      </MemoryRouter>,
    );
    const list = await screen.findByRole('list', { name: '科研文件列表' });
    expect(within(list).getByText('实验笔记.txt')).toBeTruthy();
    expect(within(list).queryByText('其他项目.txt')).toBeNull();
    expect(screen.queryByLabelText('按关联项目筛选文件')).toBeNull();
    const selected = new File(['x'], 'scope.txt');
    fireEvent.change(screen.getByLabelText('上传科研文件'), { target: { files: [selected] } });
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith(selected, { owner: 'local', mode: 'local', projectId: 'p' }),
    );
  });
  it('无效详情入口有可关闭反馈，而不是静默失败', async () => {
    open('/files?focus=deleted');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('文件已删除');
    fireEvent.click(within(alert).getByRole('button', { name: '关闭提示' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
