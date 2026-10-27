import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Drawer, DrawerContent } from '@/components/ui/drawer';

afterEach(cleanup);

function ControlledOverlay({
  drawer = false,
  customClose,
  autoFocus = false,
}: {
  drawer?: boolean;
  customClose?: (event: Event) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const content = <input aria-label="编辑标题" autoFocus={autoFocus} />;
  return (
    <>
      <button onClick={() => setOpen(true)}>编辑记录</button>
      <button>下一项</button>
      {drawer ? (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent title="编辑记录" label="编辑记录" onCloseAutoFocus={customClose}>
            {content}
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent title="编辑记录" onCloseAutoFocus={customClose}>
            {content}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

describe('通过普通按钮打开的受控弹层', () => {
  for (const drawer of [false, true]) {
    it(`${drawer ? '抽屉' : '对话框'}含 autoFocus 输入时仍恢复打开按钮`, async () => {
      render(<ControlledOverlay drawer={drawer} autoFocus />);
      const opener = screen.getByRole('button', { name: '编辑记录' });
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole('dialog');
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '编辑标题' }));
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(opener);
    });
    it(`${drawer ? '抽屉' : '对话框'}关闭后恢复打开按钮的焦点`, async () => {
      render(<ControlledOverlay drawer={drawer} />);
      const opener = screen.getByRole('button', { name: '编辑记录' });
      opener.focus();
      fireEvent.click(opener);
      await screen.findByRole('dialog');
      fireEvent.click(screen.getByRole('button', { name: '关闭' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(opener);
    });
  }

  it('保留调用方明确指定的关闭焦点', async () => {
    const customClose = vi.fn((event: Event) => {
      event.preventDefault();
      screen.getByRole('button', { name: '下一项' }).focus();
    });
    render(<ControlledOverlay customClose={customClose} />);
    const opener = screen.getByRole('button', { name: '编辑记录' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(customClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '下一项' }));
  });
});
