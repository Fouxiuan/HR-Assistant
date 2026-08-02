interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  unit: string;
  ariaLabel: string;
  onPageChange(page: number): void;
}

type PageItem = { key: string; label: string; value: number | null; active: boolean };

function buildPageItems(page: number, maxPage: number): PageItem[] {
  const items: PageItem[] = [];
  for (let value = 1; value <= maxPage; value += 1) {
    if (value === 1 || value === maxPage || (value >= page - 2 && value <= page + 2)) {
      items.push({ key: `page-${value}`, label: String(value), value, active: value === page });
    } else if (items.at(-1)?.value !== null) {
      items.push({ key: `ellipsis-${value}`, label: '…', value: null, active: false });
    }
  }
  return items;
}

export function Pagination({ page, pageSize, total, unit, ariaLabel, onPageChange }: PaginationProps) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const pages = buildPageItems(page, maxPage);

  return (
    <footer className="pagination">
      <span>共 {total} {unit}</span>
      <nav aria-label={ariaLabel}>
        <button className="button secondary small" type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
        {pages.map((item) => item.value == null ? (
          <span key={item.key} className="pagination-ellipsis" aria-hidden="true">…</span>
        ) : (
          <button
            key={item.key}
            className={`button small ${item.active ? 'primary' : 'secondary'}`}
            type="button"
            aria-current={item.active ? 'page' : undefined}
            aria-label={`第 ${item.label} 页`}
            onClick={() => onPageChange(item.value!)}
          >
            {item.label}
          </button>
        ))}
        <button className="button secondary small" type="button" disabled={page >= maxPage} onClick={() => onPageChange(page + 1)}>下一页</button>
      </nav>
    </footer>
  );
}
