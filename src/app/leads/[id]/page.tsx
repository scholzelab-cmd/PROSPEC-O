import { notFound } from "next/navigation";
import {
  doNotContactAction,
  queueDryRunAction,
  transitionLeadAction,
  queuePilotAction
} from "@/app/actions";
import { StatusPill } from "@/components/status-pill";
import { leadDetails } from "@/db/dashboard";
import {
  affiliatePipelineLabels,
  channelLabels,
  clientPipelineLabels,
  formatCurrencyFromMicros,
  formatDateTime,
  pipelineLabels
} from "@/lib/labels-pt-br";
import { affiliatePipelineStates, clientPipelineStates } from "@/lib/states";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = leadDetails(id);

  if (!data.lead) {
    notFound();
  }

  const lead = data.lead;
  const pipelineStates =
    lead.funnel === "client" ? clientPipelineStates : affiliatePipelineStates;
  const currentIndex = pipelineStates.findIndex(
    (state) => state === lead.pipeline_state
  );
  const nextPipelineState =
    currentIndex >= 0 && currentIndex < pipelineStates.length - 1
      ? pipelineStates[currentIndex + 1]
      : null;
  const canOperatorAdvance =
    nextPipelineState !== null &&
    ["interested", "whatsapp_handoff", "registered", "joined_affiliate_group", "active_affiliate"].includes(
      lead.pipeline_state
    );

  const pipelineLabel =
    lead.funnel === "client"
      ? clientPipelineLabels[
          lead.pipeline_state as keyof typeof clientPipelineLabels
        ]
      : affiliatePipelineLabels[
          lead.pipeline_state as keyof typeof affiliatePipelineLabels
        ];

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">
            {lead.funnel === "client" ? "Cliente potencial" : "Afiliado potencial"}
          </p>
          <h1 className="mt-2 text-3xl font-black">
            {lead.display_name ?? "@" + lead.instagram_username}
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {"@" + lead.instagram_username} · Pontuação {lead.score}
          </p>
        </div>
        <a
          className="button-secondary"
          href={lead.profile_url}
          target="_blank"
          rel="noreferrer"
        >
          Abrir perfil no Instagram
        </a>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="panel p-4">
          <p className="text-xs text-[var(--muted)]">Etapa do funil</p>
          <p className="mt-2 font-bold">{pipelineLabel}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-[var(--muted)]">Estado do canal</p>
          <p className="mt-2 font-bold">{channelLabels[lead.channel_state]}</p>
        </div>
        <div className="panel p-4">
          <p className="text-xs text-[var(--muted)]">Próxima ação</p>
          <p className="mt-2 font-bold">{formatDateTime(lead.next_action_at)}</p>
        </div>
      </section>


      {canOperatorAdvance ? (
        <section className="panel flex flex-wrap items-center justify-between gap-4 p-5">
          <div>
            <h2 className="font-bold">Atualizar resultado comercial</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Registre o próximo marco confirmado para alimentar atribuição e otimização.
            </p>
          </div>
          <form action={transitionLeadAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="leadId" value={lead.id} />
            <input
              type="hidden"
              name="pipelineState"
              value={nextPipelineState ?? ""}
            />
            <button className="button-primary" type="submit">
              Marcar: {nextPipelineState ? pipelineLabels[nextPipelineState] : ""}
            </button>
          </form>
        </section>
      ) : null}

      {lead.pipeline_state === "qualified" &&
      lead.channel_state === "browser_contact_pending" ? (
        <section className="grid gap-4 xl:grid-cols-2">
          <form action={queueDryRunAction} className="panel p-5">
            <input type="hidden" name="leadId" value={lead.id} />
            <h2 className="font-bold">Teste real sem envio</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Abre a aba própria, escreve a mensagem e bloqueia a ação final.
            </p>
            <label className="mt-4 grid gap-1.5 text-sm">
              Referência pública verdadeira
              <textarea
                name="publicReference"
                rows={3}
                placeholder="Conteúdo específico observado no perfil"
              />
            </label>
            <button className="button-secondary mt-4" type="submit">
              Colocar dry-run na fila
            </button>
          </form>

          <form action={queuePilotAction} className="panel border-amber-400/30 p-5">
            <input type="hidden" name="leadId" value={lead.id} />
            <h2 className="font-bold text-amber-100">Piloto com envio real</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Use somente depois de validar o dry-run e a sessão dedicada.
            </p>
            <label className="mt-4 grid gap-1.5 text-sm">
              Referência pública verdadeira
              <textarea
                name="publicReference"
                rows={2}
                placeholder="Conteúdo específico observado no perfil"
              />
            </label>
            <label className="mt-3 grid gap-1.5 text-sm">
              Confirmação
              <input
                name="confirmation"
                placeholder="Digite AUTORIZAR PILOTO"
                autoComplete="off"
              />
            </label>
            <button className="button-primary mt-4" type="submit">
              Autorizar uma primeira DM
            </button>
          </form>
        </section>
      ) : null}

      <section className="panel p-5">
        <h2 className="font-bold">Dados públicos e origem</h2>
        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-[var(--muted)]">Nicho</dt>
            <dd className="mt-1">{lead.niche ?? "Não informado"}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Origem</dt>
            <dd className="mt-1">{lead.source}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Palavra-chave</dt>
            <dd className="mt-1">{lead.source_keyword ?? "Não informada"}</dd>
          </div>
          <div className="md:col-span-3">
            <dt className="text-[var(--muted)]">Biografia pública</dt>
            <dd className="mt-1">{lead.biography ?? "Não coletada"}</dd>
          </div>
        </dl>
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">Conversa</h2>
          <StatusPill tone={data.messages.length > 0 ? "success" : "neutral"}>
            {data.messages.length + " mensagens"}
          </StatusPill>
        </div>
        <div className="mt-4 grid gap-3">
          {data.messages.map((message) => (
            <article
              key={String(message.id)}
              className={
                "max-w-2xl rounded-xl border border-[var(--line)] p-4 " +
                (message.direction === "outbound"
                  ? "ml-auto bg-emerald-400/5"
                  : "mr-auto bg-[var(--surface-strong)]")
              }
            >
              <p className="text-xs font-bold text-[var(--muted)]">
                {message.direction === "outbound" ? "Enviada" : "Recebida"} ·{" "}
                {String(message.channel)} · {formatDateTime(String(message.created_at))}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {String(message.body)}
              </p>
            </article>
          ))}
          {data.messages.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              Nenhuma mensagem registrada.
            </p>
          ) : null}
        </div>
      </section>

      <section className="panel table-shell">
        <div className="p-5 pb-2">
          <h2 className="font-bold">Decisões e custo da IA</h2>
        </div>
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Finalidade</th>
              <th>Modelo</th>
              <th>Tokens</th>
              <th>Custo</th>
            </tr>
          </thead>
          <tbody>
            {data.aiCalls.map((call) => (
              <tr key={String(call.id)}>
                <td>{formatDateTime(String(call.created_at))}</td>
                <td>{String(call.purpose)}</td>
                <td>{String(call.model)}</td>
                <td>
                  {Number(call.input_tokens) + Number(call.output_tokens)}
                </td>
                <td>
                  {formatCurrencyFromMicros(Number(call.estimated_cost_micros))}
                </td>
              </tr>
            ))}
            {data.aiCalls.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)]">
                  Nenhuma chamada de IA para este lead.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="panel p-5">
        <h2 className="font-bold">Histórico auditável</h2>
        <div className="mt-4 grid gap-2">
          {data.events.map((event) => (
            <div
              className="border-l-2 border-[var(--line)] py-1 pl-3 text-sm"
              key={String(event.id)}
            >
              <p className="font-semibold">{String(event.type)}</p>
              <p className="text-xs text-[var(--muted)]">
                {formatDateTime(String(event.created_at))} · {String(event.actor)}
              </p>
            </div>
          ))}
          {data.events.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">Sem eventos.</p>
          ) : null}
        </div>
      </section>

      {lead.channel_state !== "do_not_contact" ? (
        <form action={doNotContactAction} className="panel border-red-400/20 p-5">
          <input type="hidden" name="leadId" value={lead.id} />
          <h2 className="font-bold text-red-200">Lista de não contato</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            O bloqueio é permanente e vale para campanhas e canais futuros.
          </p>
          <button className="button-danger mt-4" type="submit">
            Não contatar este perfil
          </button>
        </form>
      ) : null}
    </div>
  );
}
