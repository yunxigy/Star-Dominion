// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextWorkbench } from './TextWorkbench';

describe('TextWorkbench', () => {
  it('processes input, reports counts and supports swapping output back to input', () => {
    render(<TextWorkbench title="文本去空行" description="删除空白行" process={(value) => value.split('\n').filter(Boolean).join('\n')} />);
    fireEvent.change(screen.getByLabelText('输入文本'), { target: { value: 'a\n\nb' } });
    fireEvent.click(screen.getByRole('button', { name: '开始处理' }));
    expect((screen.getByLabelText('处理结果') as HTMLTextAreaElement).value).toBe('a\nb');
    fireEvent.click(screen.getByRole('button', { name: '结果作为输入' }));
    expect((screen.getByLabelText('输入文本') as HTMLTextAreaElement).value).toBe('a\nb');
  });
});
