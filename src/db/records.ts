import type {
  ChannelOwner,
  ChannelState,
  Funnel,
  PipelineState
} from "@/lib/states";

export interface LeadRow {
  id: string;
  funnel: Funnel;
  pipeline_state: PipelineState;
  channel_state: ChannelState;
  instagram_username: string;
  instagram_user_id: string | null;
  display_name: string | null;
  biography: string | null;
  category: string | null;
  location: string | null;
  language: string | null;
  niche: string | null;
  source: string;
  source_keyword: string | null;
  profile_url: string;
  score: number;
  decision_maker_role: string;
  profile_signals_json: string;
  tags_json: string;
  api_window_expires_at: string | null;
  next_action_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface JobRow {
  id: string;
  kind: string;
  payload_json: string;
  status: "queued" | "running" | "completed" | "failed" | "dead_letter" | "paused";
  attempts: number;
  max_attempts: number;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  lead_id: string;
  direction: "inbound" | "outbound";
  channel: "browser" | "instagram_api" | "whatsapp" | "system";
  status: "pending" | "sent" | "delivered" | "received" | "failed" | "blocked";
  body: string;
  external_message_id: string | null;
  idempotency_key: string;
  variant_id: string | null;
  failure_reason: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface ChannelOwnershipRow {
  lead_id: string;
  owner: ChannelOwner;
  version: number;
  updated_at: string;
}
