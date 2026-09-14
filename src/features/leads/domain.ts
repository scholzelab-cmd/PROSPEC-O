import {
  affiliatePipelineStates,
  channelStates,
  clientPipelineStates,
  type AffiliatePipelineState,
  type ChannelState,
  type ClientPipelineState,
  type Funnel,
  type PipelineState
} from "@/lib/states";

const clientTransitions = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["whatsapp_handoff", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: []
} satisfies Record<ClientPipelineState, readonly ClientPipelineState[]>;

const affiliateTransitions = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["joined_affiliate_group", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: []
} satisfies Record<AffiliatePipelineState, readonly AffiliatePipelineState[]>;

const channelTransitions = {
  browser_contact_pending: [
    "browser_contact_sent",
    "human_review_required",
    "do_not_contact",
    "blocked"
  ],
  browser_contact_sent: [
    "waiting_inbound_reply",
    "human_review_required",
    "blocked"
  ],
  waiting_inbound_reply: [
    "api_eligible",
    "api_window_closed",
    "human_review_required",
    "do_not_contact",
    "completed"
  ],
  api_eligible: [
    "api_active",
    "api_window_closed",
    "human_review_required",
    "do_not_contact"
  ],
  api_active: [
    "api_window_closed",
    "human_review_required",
    "do_not_contact",
    "completed"
  ],
  api_window_closed: ["human_review_required", "do_not_contact", "completed"],
  human_review_required: ["api_active", "do_not_contact", "completed"],
  do_not_contact: [],
  blocked: ["human_review_required", "do_not_contact", "completed"],
  completed: []
} satisfies Record<ChannelState, readonly ChannelState[]>;

export class InvalidStateTransitionError extends Error {
  constructor(kind: "pipeline" | "channel", from: string, to: string) {
    super(`Invalid ${kind} transition: ${from} -> ${to}`);
    this.name = "InvalidStateTransitionError";
  }
}

export function isPipelineStateForFunnel(
  funnel: Funnel,
  value: string
): value is PipelineState {
  return funnel === "client"
    ? clientPipelineStates.some((state) => state === value)
    : affiliatePipelineStates.some((state) => state === value);
}

export function assertPipelineTransition(
  funnel: Funnel,
  from: PipelineState,
  to: PipelineState
): void {
  if (!isPipelineStateForFunnel(funnel, from) || !isPipelineStateForFunnel(funnel, to)) {
    throw new InvalidStateTransitionError("pipeline", from, to);
  }

  const allowed =
    funnel === "client"
      ? clientTransitions[from as ClientPipelineState]
      : affiliateTransitions[from as AffiliatePipelineState];

  if (!allowed.some((state) => state === to)) {
    throw new InvalidStateTransitionError("pipeline", from, to);
  }
}

export function assertChannelTransition(from: ChannelState, to: ChannelState): void {
  if (
    !channelStates.some((state) => state === from) ||
    !channelStates.some((state) => state === to) ||
    !channelTransitions[from].some((state) => state === to)
  ) {
    throw new InvalidStateTransitionError("channel", from, to);
  }
}

export interface ProfileScoreSignals {
  segmentMatch: boolean;
  keywordMatches: number;
  relevantPosts: number;
  decisionMakerEvidence: boolean;
  localGeography: boolean;
  authenticEngagement: boolean;
}

export function scoreProfile(signals: ProfileScoreSignals): number {
  const value =
    (signals.segmentMatch ? 30 : 0) +
    Math.min(signals.keywordMatches, 3) * 10 +
    Math.min(signals.relevantPosts, 3) * 8 +
    (signals.decisionMakerEvidence ? 10 : 0) +
    (signals.localGeography ? 4 : 0) +
    (signals.authenticEngagement ? 2 : 0);

  return Math.min(100, Math.max(0, value));
}
