# PROSPEC-O

A local-first, auditable Instagram commercial operations system.

## Runtime

- Next.js App Router and React
- strict TypeScript
- SQLite in WAL mode
- Drizzle schema and versioned SQL migrations
- durable SQLite job queue
- Playwright connected to an operator-owned Chrome through CDP
- official Meta webhook and Send API handoff
- official OpenAI SDK with an application-level monthly hard stop

The user interface and operator messages are in Brazilian Portuguese. Source code, database identifiers, internal states, logs, tests, and technical documentation are in English.

## Start

See [SETUP.md](./SETUP.md) for the complete operator procedure.

~~~bash
pnpm install
pnpm setup:business
pnpm dev
~~~

The single development command starts both the web application and the durable worker.

## Safety invariants

- Real business values live only in ignored config/business.json and .env.
- A browser worker creates its own tab and closes it in finally.
- Browser navigation is restricted to Instagram.
- The browser owns a thread only until the first inbound message.
- Handoff to the official API is atomic.
- A pending external delivery is never resent automatically.
- An opt-out permanently enters do_not_contact.
- Unverified claims cannot be rendered.
- Global pause and circuit-breaker state survive restarts.
- Live browser sending requires both an environment gate and explicit operator authorization.

## Verification

~~~bash
pnpm check
~~~

The E2E simulation does not access Instagram, Meta, OpenAI, or a real Chrome.
