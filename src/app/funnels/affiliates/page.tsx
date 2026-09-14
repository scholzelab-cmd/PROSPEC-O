import { PipelineBoard } from "@/components/pipeline-board";
import { pipelineLeads } from "@/db/dashboard";

export const dynamic = "force-dynamic";

export default function AffiliateFunnelPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Programa de indicação</p>
        <h1 className="mt-2 text-3xl font-black">Funil de afiliados</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          O objetivo final é gerar cliente ativo, não apenas entrar no grupo.
        </p>
      </header>
      <PipelineBoard funnel="affiliate" leads={pipelineLeads("affiliate")} />
    </div>
  );
}
