export function MetricCard({
  label,
  value,
  note
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <article className="panel p-5">
      <p className="text-sm text-[var(--muted)]">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
      {note ? <p className="mt-2 text-xs text-[var(--muted)]">{note}</p> : null}
    </article>
  );
}
