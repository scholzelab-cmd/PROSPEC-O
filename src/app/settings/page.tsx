import { setPauseAction } from "@/app/actions";
import { loadBusinessConfig } from "@/config/business";
import { dashboardSnapshot } from "@/db/dashboard";
import { getEnvironment } from "@/env";
import { formatDateTime } from "@/lib/labels-pt-br";

export const dynamic = "force-dynamic";

function configured(value: string | undefined): string {
  return value ? "Configurada" : "Pendente";
}

export default function SettingsPage() {
  const environment = getEnvironment();
  const business = loadBusinessConfig();
  const data = dashboardSnapshot();

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">Limites e segurança</p>
        <h1 className="mt-2 text-3xl font-black">Configurações</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Segredos nunca são exibidos neste painel.
        </p>
      </header>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-bold">
              {data.system.paused ? "Operação pausada" : "Operação ativa"}
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              {data.system.reason} · {formatDateTime(data.system.updatedAt)}
            </p>
          </div>
          <form action={setPauseAction}>
            <input
              type="hidden"
              name="paused"
              value={data.system.paused ? "false" : "true"}
            />
            <button
              className={data.system.paused ? "button-primary" : "button-danger"}
              type="submit"
            >
              {data.system.paused ? "Retomar" : "Pausar tudo"}
            </button>
          </form>
        </div>
      </section>

      <section className="panel p-5">
        <h2 className="font-bold">Limites operacionais</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-xs text-[var(--muted)]">DMs por dia</dt>
            <dd className="mt-1 text-xl font-bold">
              {environment.MAX_DMS_PER_DAY}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Intervalo</dt>
            <dd className="mt-1 text-xl font-bold">
              {environment.MIN_SECONDS_BETWEEN_DMS}–{environment.MAX_SECONDS_BETWEEN_DMS}s
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Janela</dt>
            <dd className="mt-1 text-xl font-bold">
              {environment.OPERATING_HOURS}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted)]">Fuso</dt>
            <dd className="mt-1 text-sm font-bold">
              {environment.OPERATING_TIMEZONE}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-bold">Credenciais</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>OpenAI</dt>
              <dd>{configured(environment.OPENAI_API_KEY)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>API oficial do Instagram</dt>
              <dd>{configured(environment.INSTAGRAM_PAGE_ACCESS_TOKEN)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Assinatura do webhook</dt>
              <dd>{configured(environment.INSTAGRAM_APP_SECRET)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Envio real pelo Chrome</dt>
              <dd>
                {environment.BROWSER_SEND_ENABLED ? "Liberado" : "Bloqueado"}
              </dd>
            </div>
          </dl>
        </div>

        <div className="panel p-5">
          <h2 className="font-bold">Configuração do negócio</h2>
          <p className="mt-3 text-sm text-[var(--muted)]">
            {business.ready
              ? "Arquivo válido e sem placeholders."
              : "Arquivo ausente, inválido ou ainda contém placeholders."}
          </p>
          <p className="mt-3 text-sm">
            Alegações verificadas:{" "}
            <strong>{business.config?.claims.verified.length ?? 0}</strong>
          </p>
          <p className="mt-1 text-sm">
            Grupo de afiliados:{" "}
            <strong>
              {business.config?.links.affiliateGroup
                ? "Configurado"
                : "Pendente"}
            </strong>
          </p>
        </div>
      </section>

      <section className="panel border-amber-400/30 p-5">
        <h2 className="font-bold text-amber-100">
          Segurança da porta de depuração
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          A porta do Chrome controla toda a sessão dedicada. Mantenha em
          127.0.0.1, nunca em 0.0.0.0 e nunca em computador compartilhado.
        </p>
      </section>
    </div>
  );
}
