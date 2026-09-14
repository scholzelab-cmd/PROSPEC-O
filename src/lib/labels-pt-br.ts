import type {
  AffiliatePipelineState,
  ChannelState,
  ClientPipelineState
} from "@/lib/states";

export const clientPipelineLabels: Record<ClientPipelineState, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  whatsapp_handoff: "Encaminhado ao WhatsApp",
  registered: "Cadastrado",
  active_customer: "Cliente ativo",
  closed: "Encerrado"
};

export const affiliatePipelineLabels: Record<AffiliatePipelineState, string> = {
  discovered: "Descoberto",
  qualified: "Qualificado",
  contacted: "Abordado",
  replied: "Respondeu",
  interested: "Interessado",
  joined_affiliate_group: "Entrou no grupo",
  active_affiliate: "Afiliado ativo",
  generated_customer: "Gerou cliente",
  closed: "Encerrado"
};

export const channelLabels: Record<ChannelState, string> = {
  browser_contact_pending: "Contato pelo navegador pendente",
  browser_contact_sent: "Contato pelo navegador enviado",
  waiting_inbound_reply: "Aguardando resposta",
  api_eligible: "Elegível para API",
  api_active: "API ativa",
  api_window_closed: "Janela da API encerrada",
  human_review_required: "Revisão humana necessária",
  do_not_contact: "Não contatar",
  blocked: "Bloqueado",
  completed: "Concluído"
};

export const jobStatusLabels: Record<string, string> = {
  queued: "Na fila",
  running: "Em execução",
  completed: "Concluído",
  failed: "Falhou",
  dead_letter: "Esgotado",
  paused: "Pausado"
};

export const integrationStatusLabels: Record<string, string> = {
  healthy: "Saudável",
  degraded: "Instável",
  unavailable: "Indisponível",
  unconfigured: "Não configurada"
};

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo"
  }).format(new Date(value));
}

export function formatCurrencyFromMicros(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2
  }).format(value / 1_000_000);
}
