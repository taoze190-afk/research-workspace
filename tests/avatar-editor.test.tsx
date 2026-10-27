import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AvatarEditor } from '@/features/account/AvatarEditor';
import { UserAvatar } from '@/components/shared/user-avatar';

const mocks = vi.hoisted(() => ({
  updateAvatar: vi.fn(),
  prepareAvatar: vi.fn(),
  refreshMe: vi.fn(),
  toast: vi.fn(),
  phase: 'signed-in',
}));
vi.mock('@/data/api', () => ({ api: { updateAvatar: mocks.updateAvatar } }));
vi.mock('@/lib/avatar', () => ({ prepareAvatar: mocks.prepareAvatar }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => mocks.toast }));
vi.mock('@/state/AuthContext', () => ({ useAuth: () => ({ phase: mocks.phase, refreshMe: mocks.refreshMe }) }));
const user = { id: 'account-a', email: 'avatar@example.test', nickname: '研究者', role: 'member', avatarDataUrl: null };
const image = 'data:image/png;base64,aW1hZ2U=';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.phase = 'signed-in';
  mocks.prepareAvatar.mockResolvedValue(image);
  mocks.updateAvatar.mockResolvedValue({ user });
  mocks.refreshMe.mockResolvedValue(undefined);
});
afterEach(cleanup);
const choose = () =>
  fireEvent.change(screen.getByLabelText('选择头像图片'), {
    target: { files: [new File(['test'], 'portrait.png', { type: 'image/png' })] },
  });

describe('头像编辑', () => {
  it('选择仅预览，点击保存后才提交，刷新账号资料', async () => {
    render(<AvatarEditor user={user} />);
    choose();
    await screen.findByRole('button', { name: '保存头像' });
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存头像' }));
    await waitFor(() => expect(mocks.refreshMe).toHaveBeenCalledTimes(1));
    expect(mocks.updateAvatar).toHaveBeenCalledWith(image);
  });
  it('取消不写服务器，移除并保存传入null', async () => {
    const view = render(<AvatarEditor user={user} />);
    choose();
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    expect(mocks.updateAvatar).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '保存头像' })).toBeNull();
    view.rerender(<AvatarEditor user={{ ...user, avatarDataUrl: image }} />);
    fireEvent.click(screen.getByRole('button', { name: '移除头像' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存头像' }));
    await waitFor(() => expect(mocks.updateAvatar).toHaveBeenCalledWith(null));
  });
  it('错误显示并保留预览可重试，离线禁止修改', async () => {
    mocks.updateAvatar.mockRejectedValueOnce(new Error('服务器暂时不可用'));
    const view = render(<AvatarEditor user={user} />);
    choose();
    fireEvent.click(await screen.findByRole('button', { name: '保存头像' }));
    expect((await screen.findByRole('alert')).textContent).toContain('服务器暂时不可用');
    expect(screen.getByRole('button', { name: '保存头像' })).toBeTruthy();
    mocks.phase = 'offline';
    view.rerender(<AvatarEditor user={user} />);
    expect((screen.getByRole('button', { name: '更换头像' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('坏头像回退到昵称首字，更换来源后重新尝试显示', () => {
    const view = render(<UserAvatar user={{ ...user, avatarDataUrl: image }} />);
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByRole('img').textContent).toBe('研');
    view.rerender(<UserAvatar user={{ ...user, avatarDataUrl: image + 'new' }} />);
    expect(document.querySelector('img')?.src).toContain('new');
  });
});
