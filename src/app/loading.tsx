export default function Loading() {
  return (
    <div className="panel animate-pulse p-8" role="status" aria-label="Carregando">
      <p className="text-sm text-[var(--muted)]">Carregando dados...</p>
    </div>
  );
}
