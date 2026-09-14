import Link from "next/link";
import { loadBusinessConfig } from "@/config/business";
import { MetricCard } from "@/components/metric-card";
import { StatusPill } from "@/components/status-pill";
import { dashboardSnapshot } from "@/db/dashboard";
import { setPauseAction } from "@/app/actions";
import {
  affiliatePipelineLabels,
  clientPipelineLabels,
  formatCurrencyFromMicros,
  formatDateTime,
  integrationStatusLabels
} from "@/lib/labels-pt-br";

export const dynamic = "force-dynamic";

const integrationNames: Record<string, string> = {
  openai: "OpenAI",
  instagram_api: "API do Instagram",
  instagram_webhook: "Webhook da Meta",
  browser: "Chrome do operador"
};

export default function DashboardPage() {
  const data = dashboardSnapshot();
  const business = loadBusinessConfig();

  return (
    <div className="grid gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Centro de operação</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">
            Visão geral
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Observe, decida, aja e aprenda com um histórico auditável.
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
            {data.system.paused ? "Retomar operação" : "Pausar tudo"}
          </button>
        </form>
      </header>

      <section
        className={
          "panel flex flex-wrap items-center justify-between gap-3 p-4 " +
          (data.system.paused
            ? "border-amber-400/30"
            : "border-emerald-400/30")
        }
        aria-label="Estado geral da automação"
      >
        <div>
          <p className="font-bold">
            {data.system.paused ? "Automação pausada" : "Automação em execução"}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Motivo: {data.system.reason} · Atualizado em{" "}
            {formatDateTime(data.system.updatedAt)}
          </p>
        </div>
        <StatusPill tone={data.system.paused ? "warning" : "success"}>
          {data.system.paused ? "Pausado" : "Ativo"}
        </StatusPill>
      </section>

      {!business.ready ? (
        <section className="panel border-amber-400/30 p-4">
          <p className="font-bold text-amber-200">
            Configuração do negócio pendente
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Preencha o arquivo local config/business.json para liberar a
            operação. Alegações comerciais permanecem bloqueadas.
          </p>
        </section>
      ) : null}

      {business.warnings.length > 0 ? (
        <section className="panel border-amber-400/30 p-4">
          <p className="font-bold text-amber-200">Pendências de segurança</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {business.config?.claims.verified.length === 0 ? (
              <li>Nenhuma alegação comercial foi verificada.</li>
            ) : null}
            {!business.config?.links.affiliateGroup ? (
              <li>O link do grupo de afiliados ainda não foi informado.</li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Leads totais" value={data.totalLeads} />
        <MetricCard label="Respostas" value={data.replies} />
        <MetricCard label="Clientes ativos" value={data.activeCustomers} />
        <MetricCard
          label="Follow-ups vencidos"
          value={data.overdueFollowUps}
        />
      </section>

      <section>
        <div className="mb-3">
          <p className="eyebrow">Economia da automação</p>
          <h2 className="mt-1 text-xl font-bold">Custo de IA</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <MetricCard
            label="Custo no mês"
            value={formatCurrencyFromMicros(data.aiCostMicros)}
            note="Estimativa com os preços definidos no .env"
          />
          <MetricCard
            label="Custo por lead"
            value={formatCurrencyFromMicros(data.aiCostPerLeadMicros)}
          />
          <MetricCard
            label="Custo por cliente ativo"
            value={formatCurrencyFromMicros(
              data.aiCostPerActiveCustomerMicros
            )}
          />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <PipelineSummary
          title="Funil de clientes"
          href="/funnels/clients"
          empty="Nenhum cliente em prospecção."
          items={data.clientPipeline.map((item) => ({
            label:
              clientPipelineLabels[
                item.state as keyof typeof clientPipelineLabels
              ],
            count: item.count
          }))}
        />
        <PipelineSummary
          title="Funil de afiliados"
          href="/funnels/affiliates"
          empty="Nenhum afiliado em prospecção."
          items={data.affiliatePipeline.map((item) => ({
            label:
              affiliatePipelineLabels[
                item.state as keyof typeof affiliatePipelineLabels
              ],
            count: item.count
          }))}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-5">
          <h2 className="font-bold">Integrações</h2>
          <div className="mt-4 grid gap-3">
            {data.integrations.map((integration) => (
              <div
                className="flex items-center justify-between gap-3"
                key={integration.integration}
              >
                <div>
                  <p className="text-sm font-semibold">
                    {integrationNames[integration.integration] ??
                      integration.integration}
                  </p>
                  <p className="text-xs text-[var(--muted)]">
                    {integration.message ?? "Sem alertas"}
                  </p>
                </div>
                <StatusPill
                  tone={
                    integration.status === "healthy"
                      ? "success"
                      : integration.status === "unavailable"
                        ? "danger"
                        : "warning"
                  }
                >
                  {integrationStatusLabels[integration.status] ??
                    integration.status}
                </StatusPill>
              </div>
            ))}
            {data.integrations.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                As verificações aparecerão após iniciar o worker.
              </p>
            ) : null}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">Exceções abertas</h2>
            <Link
              href="/exceptions"
              className="text-xs font-bold text-[var(--accent)]"
            >
              Ver fila
            </Link>
          </div>
          <div className="mt-4 grid gap-3">
            {data.exceptions.slice(0, 5).map((exception) => (
              <div
                className="rounded-lg border border-[var(--line)] p-3"
                key={exception.id}
              >
                <p className="text-sm font-semibold">{exception.code}</p>
                <p className="mt-1 line-clamp-2 text-xs text-[var(--muted)]">
                  {exception.message}
                </p>
              </div>
            ))}
            {data.exceptions.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">
                Nenhuma exceção aberta.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {business.config ? (
        <footer className="flex flex-wrap gap-2">
          <a
            className="button-secondary"
            href={business.config.company.website}
            target="_blank"
            rel="noreferrer"
          >
            Abrir Instagram
          </a>
          <a
            className="button-secondary"
            href={business.config.links.whatsapp}
            target="_blank"
            rel="noreferrer"
          >
            Abrir WhatsApp
          </a>
          {business.config.links.affiliateGroup ? (
            <a
              className="button-secondary"
              href={business.config.links.affiliateGroup}
              target="_blank"
              rel="noreferrer"
            >
              Abrir grupo de afiliados
            </a>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}

function PipelineSummary({
  title,
  href,
  empty,
  items
}: {
  title: string;
  href: string;
  empty: string;
  items: Array<{ label: string; count: number }>;
}) {
  return (
    <div className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold">{title}</h2>
        <Link
          className="text-xs font-bold text-[var(--accent)]"
          href={href}
        >
          Abrir Kanban
        </Link>
      </div>
      <div className="grid gap-2">
        {items.map((item) => (
          <div
            className="flex items-center justify-between border-b border-[var(--line)] py-2 text-sm"
            key={item.label}
          >
            <span>{item.label}</span>
            <strong>{item.count}</strong>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">{empty}</p>
        ) : null}
      </div>
    </div>
  );
}
