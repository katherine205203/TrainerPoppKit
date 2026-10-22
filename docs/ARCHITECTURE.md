# Architecture v1 — Cloudflare-first, intentionally small

## Intent and status
**Chosen provider:** Cloudflare (`LOCKED`).
**Proposed stack:** React + Vite + TypeScript app served through Cloudflare Workers, Worker HTTP API, Cloudflare D1 SQLite. This stack is a **working technical proposal**, not a completed deployment.

## Deployable system

```text
Guest phones          Owner laptop           Presenter screen
      \                    |                     /
       \-------------------|--------------------/
                           |
                    HTTPS / same app
                           |
             Cloudflare Worker + static assets
                       |             |
                 API handlers      React SPA
                       |
                    D1 database
                       |
             Result snapshots / join tokens

V1 live updates: owner/presenter polling selected status/results.
Later if needed: Durable Objects + WebSockets.
Optional later: R2 for attachments/report files (not required for MVP).
```

## Why this stack
- One Cloudflare account for deploy + database and predictable upgrade route as usage grows.
- React/Vite well suited to an interactive app with no mandatory SSR.
- D1 relational schema is sufficient for early sessions, participants, submissions and aggregates.
- Polling avoids early complexity in Durable Objects (only consider after load and latency testing).

## Proposed modular code boundaries

```text
src/
  app/                 # routes/layouts for owner, guest, presenter
  components/          # common UI design system
  features/
    tools/             # tool registry / cards
    sessions/          # class/workshop and activities
    participants/      # join, guest token, teams
    presentation/      # output/reveal control
    scarf/             # items, scoring, analytics, UI
  server/
    api/               # route handlers and validation
    auth/              # owner auth and scoped guest access
    db/                # D1 queries/migrations
    services/          # domain actions / report queries
  styles/              # tokens, type and global CSS
migrations/            # versioned D1 SQL migrations
```

This is a **logical structure proposal**, to be refined at B01.

## Core database entities (proposal)
- `owner_settings` — single owner identity/config reference.
- `tools` — tool id/version/metadata (can initially live in code if simpler).
- `sessions` — optional class/workshop container.
- `activities` — configured tool runs; nullable session reference; state and permissions.
- `teams` — optional per-session/per-activity grouping.
- `participants` — temporary guest identity per session/activity, not an app user account.
- `participant_activity_links` — link if guests reuse roster across several activities.
- `submissions` — versioned status and timestamps.
- `item_responses` — answer details, private by default.
- `score_results` — versioned computed dimensions / evidence of scoring algorithm.
- `aggregate_snapshots` — query cache optional; never replace source-of-truth submissions.
- `presentation_state` — reveal mode, selected team, comparison basis, named/anonymous status.
- `consent_records` — explicit permission/disclosure evidence where required.
- `audit_events` — sensitive read, export and reveal/permission changes.

Schema must support deletion/retention and never rely on the guest name as a unique key.

## Security requirements
- Separate `/owner/*` and `/api/owner/*` from public `/join/*` and scoped `/api/guest/*`.
- Owner auth must be verified server-side; protect endpoints even if frontend routes are hidden.
- Validate signed opaque/random activity guest tokens server-side; expiry, scope, revocation and rate limiting.
- Avoid exposing raw submissions or participant names in public API responses. Return only permitted personal/aggregate/presentation data.
- Join PIN is a participation gate, not an authorization system for results/owner actions. Store securely where practicable, rotate/expire, rate-limit guesses.
- Avoid putting secret tokens or named personal results into QR image URLs.
- Lock/reveal result state on server. Guest cannot change presenter state by altering client payload.
- Parameterized DB queries, strict schema validation, request limits, no PII in logs.
- For real class use, implement basic backup/export/recovery and operational alerting.

## Realtime plan
- Phase 1: poll owner progress every 3–10 seconds as appropriate; presenter can similarly poll published state. Adapt based on tests and cost.
- Responses write to D1; server aggregates queried on demand or cached.
- The owner command to reveal/hide updates persistent presentation state.
- Do not assume 50 phones should poll server continuously while answering; minimize guest polling.
- If observed latency/traffic warrants, evaluate a per-activity Durable Object with WebSocket hibernation; do not introduce prematurely.

## Operational notes
- Use `wrangler` and repo-connected deployments; dev/staging/prod separation when data becomes real.
- Choose descriptive, safe D1 migration names; run migrations in controlled order.
- Work within Workers/D1 Free limits during development and load-test before events. Upgrade as needed rather than overprovisioning from day one.
- Use Cloudflare secrets/bindings, never commit access keys, tokens or production participant exports.
- Prefer portable domain logic and pure scoring functions; avoid coupling core business semantics to Cloudflare-specific objects.

## Not yet decided
Owner auth solution; user-facing custom domain; data retention policy; exact deployment topology; backing up D1; production privacy/legal notices; export format; tool manifest design.
