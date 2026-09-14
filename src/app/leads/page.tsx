import Link from "next/link";
import { createLeadAction } from "@/app/actions";
import { getDatabase } from "@/db/client";
import { listLeads } from "@/features/leads/service";
import {
  affiliatePipelineLabels,
  channelLabels,
  clientPipelineLabels
} from "@/lib/labels-pt-br";

export const dynamic = "force-dynamic";

export default function LeadsPage() {
  const leads = listLeads(getDatabase().sqlite);

  return (
    <div className="grid gap-6">
      <header>
        <p className="eyebrow">CRM</p>
        <h1 className="mt-2 text-3xl font-black">Leads</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Cadastre um perfil público sem criar duplicidade.
        </p>
      </header>

      <details className="panel p-5">
        <summary className="cursor-pointer font-bold">
          Cadastrar perfil manualmente
        </summary>
        <form
          action={createLeadAction}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="grid gap-1.5 text-sm">
            Funil
            <select name="funnel" required defaultValue="client">
              <option value="client">Cliente</option>
              <option value="affiliate">Afiliado</option>
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            Usuário do Instagram
            <input
              name="instagramUsername"
              placeholder="@perfil"
              required
              autoComplete="off"
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Nome exibido
            <input name="displayName" placeholder="Nome público do perfil" />
          </label>
          <label className="grid gap-1.5 text-sm">
            Nicho
            <input name="niche" placeholder="Arquitetura, imóveis..." />
          </label>
          <label className="grid gap-1.5 text-sm">
            Palavra-chave de origem
            <input name="sourceKeyword" placeholder="imagem por IA" />
          </label>
          <label className="grid gap-1.5 text-sm">
            Pontuação
            <input
              name="score"
              type="number"
              min="0"
              max="100"
              defaultValue="60"
              required
            />
          </label>
          <label className="grid gap-1.5 text-sm md:col-span-2">
            Referência pública verdadeira
            <textarea
              name="publicReference"
              rows={3}
              placeholder="Ex.: o vídeo do empreendimento publicado ontem"
            />
          </label>
          <div className="md:col-span-2">
            <button className="button-primary" type="submit">
              Cadastrar lead
            </button>
          </div>
        </form>
      </details>

      <section className="panel table-shell">
        <table>
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Funil</th>
              <th>Etapa</th>
              <th>Canal</th>
              <th>Pontuação</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => {
              const pipelineLabel =
                lead.funnel === "client"
                  ? clientPipelineLabels[
                      lead.pipeline_state as keyof typeof clientPipelineLabels
                    ]
                  : affiliatePipelineLabels[
                      lead.pipeline_state as keyof typeof affiliatePipelineLabels
                    ];

              return (
                <tr key={lead.id}>
                  <td>
                    <Link
                      href={"/leads/" + lead.id}
                      className="font-bold hover:text-[var(--accent)]"
                    >
                      {lead.display_name ?? "@" + lead.instagram_username}
                    </Link>
                    <p className="text-xs text-[var(--muted)]">
                      {"@" + lead.instagram_username}
                    </p>
                  </td>
                  <td>{lead.funnel === "client" ? "Cliente" : "Afiliado"}</td>
                  <td>{pipelineLabel}</td>
                  <td>{channelLabels[lead.channel_state]}</td>
                  <td>{lead.score}</td>
                </tr>
              );
            })}
            {leads.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[var(--muted)]">
                  Nenhum lead cadastrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
