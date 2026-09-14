# Architecture

## Shape

The application is a modular monolith. The Next.js dashboard and local worker share one SQLite source of truth. There is no Redis or external queue.

## Channel ownership

Every lead has one row in channel_ownership. A first-contact reservation requires owner=browser. The first inbound webhook stores the message, updates the API window, changes the channel state, and transfers ownership to api in one SQLite transaction. API replies require owner=api.

External sends use a durable message reservation with a unique idempotency key. If a process stops after an external send but before confirmation, the reservation remains pending and automatic retry is blocked as delivery-uncertain. This favors no duplicate over an unsafe resend.

## Browser boundary

BrowserContactClient uses chromium.connectOverCDP, reuses browser.contexts()[0], and creates context.newPage(). It never adopts a user tab, never calls bringToFront, never launches another Chrome, and always closes its own page in finally. All target and final URLs must be HTTPS Instagram URLs.

A module-level mutex permits one browser job at a time. The live path requires BROWSER_SEND_ENABLED plus a timestamped operator authorization in the durable job payload.

## Persistence

Versioned SQL migrations enable foreign keys, WAL, busy timeout, unique lead, message, webhook and job constraints, audit events, circuit breakers, experiments, AI costs, exceptions, and browser diagnostics. A singleton system_state row starts paused.

The worker atomically claims one queued job, records leases, retries with bounded exponential delay, moves exhausted work to dead-letter, and recovers stale running jobs after restart.

## Claims and decisions

The model classifies into a fixed intent and action schema. It does not write final outbound copy. The renderer selects exact verified claim text by ID and rejects configured unverified claims. Price requests and uncertainty can be routed to human review. Opt-out detection runs before any model call.

## Optimization

Experiment assignment is deterministic and unique per lead. Evaluation uses Wilson confidence intervals and requires the minimum sample for every variant. Allocation changes keep an exploration share and are auditable and reversible.

## Deployment boundary

SQLite is intentionally local. Move to PostgreSQL only when the system needs multiple machines, remote deployment, or write concurrency incompatible with SQLite.
