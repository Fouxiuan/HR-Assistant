export function LoadingState({ label = '正在加载…' }: { label?: string }) {
  return <div className="state-card muted" role="status" aria-live="polite">{label}</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state-card danger" role="alert">{message}</div>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
