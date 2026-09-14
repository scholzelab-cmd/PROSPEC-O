import { resolveExceptionAction } from "@/app/actions";
import { getDatabase } from "@/db/client";
import { formatDateTime } from "@/lib/labels-pt-br";

export const dynamic = "force-dynamic";

const codeLabels: Record<string, string> = {
  browser_unavailable: "Chrome indisponível",
  instagram_restriction: "Restrição do Instagram",
  unmatched_inbound: "Resposta sem lead correspondente",
  human_review_required: "Revisão humana necessária",
  job_dead_letter: "Job esgotou as tentativas"
};

export default function ExceptionsPage() {
  const rows = getDatabase()
    .sqlite.prepare(
      `SELECT id, code, message, lead_id, job_id, status, created_at
       FROM exceptions ORDER BY
       CASE status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
       created_at DESC LIMIT 300`
    )
    .all() as Array<Record<string, string | null>>;

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Intervenção do operador</p>
        <h1 className="mt-2 text-3xl font-black">Fila de exceções</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Situações fora dos limites aprovados param aqui, sem contorno
          automático.
        </p>
      </header>

      <section className="grid gap-3">
        {rows.map((row) => (
          <article className="panel p-5" key={String(row.id)}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-bold">
                  {codeLabels[String(row.code)] ?? "Exceção operacional"}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Código técnico: {String(row.code)}
                </p>
                <p className="mt-3 max-w-3xl text-sm">{String(row.message)}</p>
                <p className="mt-3 text-xs text-[var(--muted)]">
                  {formatDateTime(String(row.created_at))}
                  {row.lead_id ? " · Lead " + String(row.lead_id) : ""}
                  {row.job_id ? " · Job " + String(row.job_id) : ""}
                </p>
              </div>
              {row.status === "open" ? (
                <form action={resolveExceptionAction}>
                  <input
                    type="hidden"
                    name="exceptionId"
                    value={String(row.id)}
                  />
                  <button className="button-secondary" type="submit">
                    Marcar como resolvida
                  </button>
                </form>
              ) : (
                <span className="text-xs text-[var(--muted)]">Resolvida</span>
              )}
            </div>
          </article>
        ))}
        {rows.length === 0 ? (
          <div className="panel p-10 text-center text-[var(--muted)]">
            Nenhuma exceção registrada.
          </div>
        ) : null}
      </section>
    </div>
  );
}
