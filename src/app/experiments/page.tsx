import { createExperimentAction } from "@/app/actions";
import { experimentRows } from "@/db/dashboard";

export const dynamic = "force-dynamic";

export default function ExperimentsPage() {
  const experiments = experimentRows();

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Aprendizado controlado</p>
        <h1 className="mt-2 text-3xl font-black">Experimentos</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Uma variável por vez, controle fixo e amostra mínima antes de adaptar.
        </p>
      </header>

      <details className="panel p-5">
        <summary className="cursor-pointer font-bold">
          Criar teste A/B
        </summary>
        <form
          action={createExperimentAction}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="grid gap-1.5 text-sm">
            Nome do teste
            <input name="name" required placeholder="Abertura contextual" />
          </label>
          <label className="grid gap-1.5 text-sm">
            Funil
            <select name="funnel" required defaultValue="client">
              <option value="client">Clientes</option>
              <option value="affiliate">Afiliados</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm md:col-span-2">
            Única variável testada
            <input
              name="variable"
              required
              placeholder="Pergunta final da primeira mensagem"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Conteúdo de controle
            <textarea name="control" rows={4} required />
          </label>
          <label className="grid gap-1.5 text-sm">
            Conteúdo da variante
            <textarea name="variant" rows={4} required />
          </label>
          <div className="md:col-span-2">
            <button className="button-primary" type="submit">
              Iniciar com divisão 50/50
            </button>
          </div>
        </form>
      </details>

      <section className="panel table-shell">
        <table>
          <thead>
            <tr>
              <th>Experimento</th>
              <th>Funil</th>
              <th>Variável</th>
              <th>Estado</th>
              <th>Amostra</th>
              <th>Conversões</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((experiment) => (
              <tr key={String(experiment.id)}>
                <td className="font-bold">{String(experiment.name)}</td>
                <td>
                  {experiment.funnel === "client" ? "Clientes" : "Afiliados"}
                </td>
                <td>{String(experiment.variable)}</td>
                <td>
                  {experiment.status === "running"
                    ? "Em execução"
                    : String(experiment.status)}
                </td>
                <td>
                  {String(experiment.sample_size)} / mínimo{" "}
                  {String(experiment.minimum_sample_size)}
                </td>
                <td>{String(experiment.conversions)}</td>
              </tr>
            ))}
            {experiments.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[var(--muted)]">
                  Nenhum experimento criado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
