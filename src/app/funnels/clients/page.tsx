import { PipelineBoard } from "@/components/pipeline-board";
import { pipelineLeads } from "@/db/dashboard";

export const dynamic = "force-dynamic";

export default function ClientFunnelPage() {
  return (
    <div>
      <header className="mb-6">
        <p className="eyebrow">Pipeline comercial</p>
        <h1 className="mt-2 text-3xl font-black">Funil de clientes</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Da descoberta ao cliente ativo, sem misturar estado de canal.
        </p>
      </header>
      <PipelineBoard funnel="client" leads={pipelineLeads("client")} />
    </div>
  );
}
