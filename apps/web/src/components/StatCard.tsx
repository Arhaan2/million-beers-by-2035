import { useId, type ReactNode } from 'react';

export function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
}) {
  const labelId = useId();
  return (
    <article className="stat-card" aria-labelledby={labelId}>
      <p id={labelId}>{label}</p>
      <strong>{value}</strong>
      {detail ? <span>{detail}</span> : null}
    </article>
  );
}
