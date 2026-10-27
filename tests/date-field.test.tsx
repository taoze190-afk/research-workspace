import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { DateField } from '@/components/shared/date-field';

afterEach(cleanup);

describe('日期清除行为', () => {
  it('可选截止日期清空后仍保留日期输入焦点', () => {
    function Editor() {
      const [value, setValue] = useState<string | null>('2026-10-25');
      return <DateField label="截止日期" value={value} onChange={setValue} />;
    }
    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }));
    const input = screen.getByLabelText('截止日期') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole('button', { name: '清除日期' })).toBeNull();
  });

  it('必填实验日期不显示会误改为今天的清除入口', () => {
    const change = vi.fn();
    render(<DateField label="实验日期" value="2026-10-20" clearable={false} quick={false} onChange={change} />);
    expect(screen.queryByRole('button', { name: '清除日期' })).toBeNull();
    fireEvent.change(screen.getByLabelText('实验日期'), { target: { value: '2026-10-24' } });
    expect(change).toHaveBeenCalledWith('2026-10-24');
  });
});
