import { recentJobs } from "@/db/dashboard";
import {
  formatDateTime,
  jobStatusLabels
} from "@/lib/labels-pt-br";
import { StatusPill } from "@/components/status-pill";

export const dynamic = "force-dynamic";

export default function JobsPage() {
  const jobs = recentJobs();

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Execução durável</p>
        <h1 className="mt-2 text-3xl font-black">Fila de jobs</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Tentativas, recuperação e dead-letter persistem após reiniciar.
        </p>
      </header>

      <section className="panel table-shell">
        <table>
          <thead>
            <tr>
              <th>Job</th>
              <th>Tipo</th>
              <th>Estado</th>
              <th>Tentativas</th>
              <th>Disponível em</th>
              <th>Último erro</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => (
              <tr key={String(job.id)}>
                <td className="max-w-44 break-all text-xs">{String(job.id)}</td>
                <td>{String(job.kind)}</td>
                <td>
                  <StatusPill
                    tone={
                      job.status === "completed"
                        ? "success"
                        : job.status === "dead_letter"
                          ? "danger"
                          : job.status === "running"
                            ? "warning"
                            : "neutral"
                    }
                  >
                    {jobStatusLabels[String(job.status)] ?? String(job.status)}
                  </StatusPill>
                </td>
                <td>
                  {String(job.attempts)} / {String(job.max_attempts)}
                </td>
                <td>{formatDateTime(String(job.available_at))}</td>
                <td className="max-w-80 text-xs text-[var(--muted)]">
                  {job.last_error ? String(job.last_error) : "—"}
                </td>
              </tr>
            ))}
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[var(--muted)]">
                  Nenhum job registrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
