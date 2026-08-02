import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

describe('Pagination', () => {
  it('renders compact page numbers and reports the selected page', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={5} pageSize={10} total={120} unit="人" ariaLabel="候选人分页" onPageChange={onPageChange} />);

    expect(screen.getByText('共 120 人')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '第 5 页' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByText('…')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '第 6 页' }));
    expect(onPageChange).toHaveBeenCalledWith(6);
  });
});
