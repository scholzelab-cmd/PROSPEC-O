import Link from "next/link";
import type { LeadRow } from "@/db/records";
import { channelLabels, pipelineLabels } from "@/lib/labels-pt-br";
import {
  affiliatePipelineStates,
  clientPipelineStates,
  type Funnel
} from "@/lib/states";

export function PipelineBoard({
  funnel,
  leads
}: {
  funnel: Funnel;
  leads: LeadRow[];
}) {
  const states =
    funnel === "client" ? clientPipelineStates : affiliatePipelineStates;

  return (
    <div className="grid auto-cols-[17rem] grid-flow-col gap-3 overflow-x-auto pb-4">
      {states.map((state) => {
        const stateLeads = leads.filter(
          (lead) => lead.pipeline_state === state
        );

        return (
          <section
            className="min-h-64 rounded-xl border border-[var(--line)] bg-[#090d13] p-3"
            key={state}
            aria-label={pipelineLabels[state]}
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-bold">{pipelineLabels[state]}</h2>
              <span className="rounded-full bg-[var(--surface-strong)] px-2 py-0.5 text-xs text-[var(--muted)]">
                {stateLeads.length}
              </span>
            </header>

            <div className="grid gap-2">
              {stateLeads.map((lead) => (
                <Link
                  href={`/leads/${lead.id}`}
                  key={lead.id}
                  className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 transition hover:border-[var(--accent-strong)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-bold">
                      {lead.display_name ?? `@${lead.instagram_username}`}
                    </p>
                    <span className="text-xs font-bold text-[var(--accent)]">
                      {lead.score}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--muted)]">
                    @{lead.instagram_username}
                  </p>
                  <p className="mt-2 text-[0.68rem] text-[#99a6b7]">
                    {channelLabels[lead.channel_state]}
                  </p>
                </Link>
              ))}

              {stateLeads.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--line)] p-3 text-center text-xs text-[var(--muted)]">
                  Nenhum lead nesta etapa
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
