import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectFilesSummary } from '@/features/files/ProjectFilesSummary';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock('@/state/AuthContext', () => ({ useAuth: mocks.auth }));
vi.mock('@/features/files/repository', async (original) => ({
  ...(await original<typeof import('@/features/files/repository')>()),
  listResearchFiles: mocks.list,
}));
const file = (id: string, projectId: string) => ({
  id,
  name: id + '.txt',
  mimeType: 'text/plain',
  size: 5,
  createdAt: 1,
  updatedAt: 1,
  sha256: '',
  projectId,
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockReturnValue({ phase: 'local', user: null });
});
afterEach(cleanup);
describe('项目文件摘要', () => {
  it('只显示当前项目文件，预览留在项目内且AI入口带对范围', async () => {
    mocks.list.mockResolvedValue({ files: [file('p-file', 'p'), file('other-file', 'other')] });
    render(
      <MemoryRouter>
        <ProjectFilesSummary projectId="p" />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('region', { name: '项目科研文件' });
    const preview = await within(panel).findByRole('link', { name: /^p-file.txt/ });
    expect(preview.getAttribute('href')).toBe('/projects/p?tab=files&focus=p-file');
    expect(within(panel).queryByText('other-file.txt')).toBeNull();
    expect(
      new URL(
        within(panel).getByRole('link', { name: '让 AI 读取：p-file.txt' }).getAttribute('href')!,
        'http://local',
      ).searchParams.get('scope'),
    ).toBe('project:p');
  });
  it('切换账号后旧请求的文件名不进入新账号摘要', async () => {
    let finish!: (value: unknown) => void;
    mocks.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ files: [file('new-owner', 'p')] });
    const { rerender } = render(
      <MemoryRouter>
        <ProjectFilesSummary projectId="p" />
      </MemoryRouter>,
    );
    mocks.auth.mockReturnValue({ phase: 'signed-in', user: { id: 'user-b' } });
    rerender(
      <MemoryRouter>
        <ProjectFilesSummary projectId="p" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('new-owner.txt')).toBeTruthy();
    finish({ files: [file('private-old-owner', 'p')] });
    await waitFor(() => expect(screen.queryByText('private-old-owner.txt')).toBeNull());
    expect(mocks.list).toHaveBeenLastCalledWith('user-b', 'server');
  });
});
