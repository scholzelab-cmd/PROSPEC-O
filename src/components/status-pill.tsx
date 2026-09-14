export function StatusPill({
  tone,
  children
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  const colors = {
    success: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    warning: "border-amber-400/30 bg-amber-400/10 text-amber-200",
    danger: "border-red-400/30 bg-red-400/10 text-red-200",
    neutral: "border-slate-400/30 bg-slate-400/10 text-slate-200"
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}
    >
      {children}
    </span>
  );
}
