# Implementation roadmap — build in small verified batches

**As of 2026-10-23:** The single-owner Cloudflare app includes Reflection Wall v1.0, SCARF Assessment with v1.1 scoring, Poll v1.2, Word Cloud v1.0, and Learning Behaviors Reflection v1.0. SCARF uses the v0.2 question bank and remains experimental/unvalidated. Production health returns 200, its public client bundle contains LBR, and the remote D1 migration list has no pending migrations. Authenticated production trainer and six-person participant UAT remain unverified.

**UI consistency follow-up (2026-10-23):** SCARF detail/setup/results no longer use experimental status badges; the setup and results keep a compact plain-text instrument limitation disclosure. Tool-focused routes hide the global search/create controls. The SCARF result-release choices now use compact, responsive selection cards with readable helper text, and the Word Cloud editor removes its promotional privacy panel and wraps long question previews within the card.

## Phase 01 — Design system integration
- B01a: Brand rename and design tokens/components (`TrainerPopp!Kit` rather than legacy name in PDF).
- B01b: Desktop owner layout, guest mobile shell, projector-safe presenter shell with empty/loading/error states.
- Acceptance: responsive UI consistently matches approved visual direction; components are real/evaluable rather than flattened background images.

## Phase 02 — Cloudflare foundation
- B02a: React/Vite/TS scaffold, Workers deployment, D1 binding, migrations, basic app routes.
- B02b: Secure **single-owner** sign-in, tool library, session/quick activity definitions.
- Acceptance: running URL, database persists class/activity, endpoints enforce owner vs guest scopes, CI build/typecheck/test passes.

## Phase 03 — Guest join and activity lifecycle
- B03a: public join link / optional PIN, QR generation and scoped guest identity.
- B03b: optional teams, trainer assignment, mobile activity runner state and submission contract.
- Acceptance: guest can join without account, owner sees count, invalid/expired PIN fails safely, refresh/retry does not duplicate participant/submission.

## Phase 04 — SCARF specialized tool
- B04a: **Done:** implement the user-provided 30-item English v0.2 candidate bank as experimental content; follow P01–P08 and retain clear validation disclaimers.
- B04b: **Done locally:** v1.1 scoring adds the Integrated Needs Profile while preserving Reaction Intensity and Driver Priority; versioned server scoring, participant autosave/resume, result release, personal results, additive migration, audit/reset and supplied-vector tests are implemented.
- Acceptance: scoring formulas match the supplied bank; all five domains are correctly labelled; no dimension/scoring keys reach participant questions; trainer and presenter access are separated.

## Phase 05 — Live results / Presenter
- B05a: **Done locally:** trainer progress, required release mode, preserved reaction/priority measures, Integrated Needs individual/team heatmaps, named individual detail, activity/session CSV export and trainer reset.
- B05b: **Done locally:** distinct short-lived activity/session presenter capabilities, compatible/released session aggregation with identity deduplication, aggregate-only Integrated Needs output, five-person threshold and whole-team/complementary suppression.
- Acceptance: local smoke covers release, aggregate threshold, suppression, named owner analytics and stale-generation rejection. A live 20–50-person workshop and remote browser verification remain operational validation work.

## Phase 06 — Poll Module v1.2
- B07a: **Done locally:** native Poll activity schema and lifecycle, Single/Multiple Choice, Other, Anonymous/Named modes, standalone and Session flows, Session identity reuse, direct and Session QR/link/PIN entry.
- B07b: **Done locally:** participant vote/edit/wait/results states; trainer live control, analytics, visibility controls, CSV export and archive access; aggregate-only fullscreen Presenter; rate limiting, HMAC response identity and idempotent writes.
- Acceptance: `npm test` passes 21 tests; `npm run smoke` passes 715 local Worker/D1 assertions including 200 simultaneous votes distributed across three Live Session Polls. A-01/A-02 stay provisional. All eight UI screen families are implemented; pixel-diff comparison and live workshop review remain unverified.

## Phase 07 — Stabilization, then expansion
- B06a: **Remaining:** larger/remote D1 capacity checks beyond the local 200-vote run, backups/recovery, accessibility audit, logs, low-cost hosting monitoring, psychometric validation and any legal/usage review.
- B06b: **Done locally:** Learning Behaviors Reflection v1.0 is implemented as a distinct activity module with its own locked content, participant/peer flow, personal reflection, trainer analytics, and aggregate-only Presenter.
- Acceptance: one real trainer-led class succeeds end-to-end; meaningful defects tracked and resolved; next tool does not require redesigning core session/join/presenter models.

## Phase 08 — Word Cloud v1.0
- B08a: **Done locally:** native anonymous activity schema and lifecycle, standalone and Session/team entry, 1–10 normalized word submission, device-local draft and one-time submit, moderation and distinct-submitter frequency, results/export and aggregate-only Presenter.
- B08b: **Done locally:** responsive trainer and participant views, Archive/Live/Home/Tools/Session navigation, close race guard, safe duplicate/delete behavior, and 200-submission local Worker/D1 load smoke.
- Acceptance: `npm test` passes 28 tests; `npm run smoke` passes 967 local Worker/D1 assertions including 200 near-simultaneous anonymous submissions. Migrations 0005/0006 are applied locally. Pixel-diff fidelity and remote Cloudflare deployment remain unverified.

## Phase 09 — Reflection Wall v1.0
- B09a: **Done locally:** additive D1 schema, trainer setup, scoped participant actors, anonymous/named modes, Session/Activity navigation, code/link join, lifecycle, Post-its, comments, six reactions, moderation and reversible clustering.
- B09b: **Done locally:** content-free event cursor polling, trainer analytics and safe CSV, Presenter capability and Off/All/Focus/Spotlight/Cluster/Blank modes, responsive participant layout and archive/reopen.
- Acceptance: `npm test` passes 32 tests; `npm run smoke` passes 1,017 local Worker/D1 assertions, including 200 simultaneous Reflection Wall submissions, access revoke/rotate, moderation audit notes and first-post column locking. Migrations 0007–0009 are applied locally. Browser accessibility inspection covers trainer overview/editor; live workshop, network reconnect/device behavior, pixel-diff fidelity and authenticated production UAT remain unverified.

## Phase 10 — Learning Behaviors Reflection v1.0
- B10a: **Done locally:** Additive D1 schema and seed for the six locked behaviors; trainer setup, live controls and team/individual analytics; temporary participant Self ratings, peer rounds, Quick Notes, My Reflection and My Actions; session-linked and standalone entry; completion/reopen lifecycle.
- B10b: **Done locally:** Aggregate-only Presenter with six group Self means and respondent counts; participant disclosure; privacy-scoped peer form; edit freeze after first Self response; write guards, revisions, idempotent peer submit and safe exports.
- Acceptance: `npm test` passes 42 tests; the local six-participant Worker/D1 LBR walkthrough passes 144 assertions; `npm run smoke` passes 1,020 Worker/D1 regression assertions. `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` pass. Local migration 0011 is applied. Trainer setup/live, participant Intro/Self and Presenter were visually checked in the browser; numeric pixel fidelity, live workshop/UAT and authenticated production acceptance remain unverified.

## Per-batch handoff template

```markdown
### Batch B0x completion
- Implemented:
- Changed files / migration:
- Tested commands / results:
- UI screenshots (desktop / mobile / presenter):
- Security and privacy checks:
- Open issues and dependencies:
- Decision requests (not silently approved):
- Next recommended batch:
```

## First Codex prompt (copy/paste)

```text
Read AGENTS.md and the documentation it references. Start with B01a + the minimum Cloudflare scaffold needed to preview the design system locally. Keep the product single-owner and the frontend in the Popp! flat style. Do not invent production SCARF questions, scoring rules, or consent. Implement shared color/type/layout tokens and functional components; provide a live dev preview, tests actually run, and a concise completion report. Preserve all LOCKED decisions and report any conflicts before changing them.
```
