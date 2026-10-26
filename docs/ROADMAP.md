# Implementation roadmap — build in small verified batches

**As of 2026-10-23:** The single-owner Cloudflare app includes Reflection Wall v1.0, SCARF Assessment with v1.1 scoring, Poll v1.2, Word Cloud v1.0, and Learning Behaviors Reflection v1.0. SCARF uses the v0.2 question bank and remains experimental/unvalidated. Production health returns 200, its public client bundle contains LBR, and the remote D1 migration list has no pending migrations. Authenticated production trainer and six-person participant UAT remain unverified.

**UI consistency follow-up (2026-10-23):** SCARF detail/setup/results no longer use experimental status badges; the setup and results keep a compact plain-text instrument limitation disclosure. Tool-focused routes hide the global search/create controls. The SCARF result-release choices now use compact, responsive selection cards with readable helper text, and the Word Cloud editor removes its promotional privacy panel and wraps long question previews within the card.

**SCARF Control Room & Presenter v1.3 (2026-10-24):** Implemented locally from the approved v1.3 update pack. The trainer now uses one Control Room, Presenter follows `Open → Present → lobby → Close → Reveal heatmap`, personal release is independent, and one-participant named Individual reveal is supported. Migration 0015 is applied locally; Chrome QA and the 1,026-assertion smoke run passed. Remote deployment and live workshop UAT remain outstanding.

**Word Cloud Control Room & Presenter v1.1 (2026-10-24):** Implemented locally from the supplied update pack. Word Cloud now has one Control Room with QR/link/PIN, named lobby participation progress, private aggregate preview, independent Presenter team scope and explicit `Live Word Cloud` / `Close & Reveal` flows. Presenter uses `JOIN_LOBBY → LIVE_CLOUD / ACTIVITY_CLOSED → FINAL_CLOUD`, with safe aggregate-only payloads and short polling synchronization. Migration 0016 is applied locally; Chrome QA and the 1,029-assertion cross-tool smoke run passed. Remote migration/deployment and live workshop UAT remain outstanding.

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
- B05b: **Done locally:** distinct short-lived activity/session presenter capabilities, v1.3 Control Room state machine, named live lobby, explicit close/reveal controls, Individual and Team heatmaps, independent personal release, short polling synchronization and raw-answer exclusion.
- Acceptance: local smoke covers release independence, one-participant reveal, close/submit gating, named Presenter rows, team/class switches, owner analytics and stale-generation rejection. A live 20–50-person workshop and remote browser verification remain operational validation work.

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

## Phase 11 — Quiz v1.0
- B11a: **Implemented locally:** text-only Quiz Definitions with draft/publish/retire/duplicate, Activity placement in or outside a Session, sequential isolated Runs, scoped QR/link/PIN joining, and owner-only setup, console, results, correction audit and CSV.
- B11b: **Implemented locally:** Live Individual/Team in Manual or Automatic mode with server-authoritative shared timers, Pause/Resume, early lock, 2-second transition and 3-second countdown; Hope ×1/×2/×3 and Accuracy/Speed scoring; Self-paced autosave/versioning, optional individual timer, result release and review policies; read-only phase-filtered Presenter. Session archive/reopen and existing Home/Session/Live/Archive navigation include Quiz.
- Acceptance: local migration 0012 applied. `npm test` passes 60 tests, `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` pass. `npm run smoke:quiz` covers owner auth, join permissions, Manual/Automatic, mid-question and final-question joins, a six-person Workshop, fresh Run isolation, Team DQ divisor, Self-paced, Void/Regrade, CSV privacy, Presenter projection and Session archive guard. Existing `npm run smoke` passes 1,020 cross-tool assertions. `npm run load:quiz` accepted 200/200 concurrent local Live answers with no errors (p50 540 ms, p95 968 ms, p99 968 ms); trainer lock acknowledgement 18 ms and subsequent guest read 8 ms. Mobile public Quiz join/lobby was inspected in the browser; full trainer/presenter visual acceptance, remote migration/deploy and real workshop UAT remain to be done. Local timings do not guarantee remote capacity.

## Phase 12 — Global Data Management v1.0
- B12a: **Implemented locally:** shared Activity/Run ledger and provenance, immutable config/result snapshots, stable Activity URLs and Session access generations, Current/History semantics, Reset/New Run, Session reset branches, archived Session source manifests and participant-access guards across the existing modules.
- B12b: **Implemented locally:** Session/Activity/Run soft-delete packages, 30-day Trash/Restore/Purge, restore modes, previewed bulk deletion with cascade de-duplication, scoped Activity/Run/Session and Archive-selection CSV/Excel-readable exports, Run result history and audit events.
- Acceptance: local migration 0013 and 0014 applied. `npm test` passes 63 tests; `npm run smoke:gdm` passes 83 local Worker/D1 assertions; `npm run smoke:quiz` passes its owner/access, lifecycle and six-person Workshop flow; `npm run smoke` passes 1,023 cross-tool assertions. Typecheck, lint, build and `git diff --check` pass. Start New Run, Reset, archive snapshots, Delete, Restore and per-package purge use D1 transaction batches. Remaining: operation-receipt crash window, Excel download is Excel-readable HTML `.xls` rather than native `.xlsx`, and remote migration/deployment, purge timing/recovery and trainer-led UAT are not verified. See `docs/GDM_AUDIT.md`.

## Phase 13 — Poll Module v1.3
- B13a: **Implemented locally:** additive presenter context/token schema, Live Results vs Close → Reveal configuration, server-enforced close-before-reveal, scoped Session/Activity Presenter links, real-time polling state synchronization, Session Spotlight, display-only Freeze/Resume snapshots, and GDM-compatible reopen guard.
- B13b: **Implemented locally:** unified Control Room UI, projector-first Presenter state screens (Lobby, Voting Hidden, Live Results, Closed, Final Results, Frozen, Empty, Reconnecting), QR/link/PIN lobby access, aggregate-only payloads outside Lobby, motion/reduced-motion handling, and removal of the redundant Presenter controls console.
- Acceptance: local migration 0017 applied. `npm test` passes 63 tests; `npm run smoke` passes 1,030 local Worker/D1 assertions including the Close-before-Reveal gate, 200-person Session Poll load, idempotent Other responses, aggregate-only Presenter output and Poll lifecycle. `npm run typecheck`, `npm run lint`, `npm run build`, and browser checks at 390×844 pass for Control Room, hidden/live/frozen/final Presenter states. Remaining: full 50-case acceptance matrix, production/remote migration and deployment, remote capacity testing, and pixel-diff review against every approved PNG remain unverified. A-01/A-02 GDM assumptions remain provisional.

## Phase 14 — Quiz Module v1.2 Update Pack
- B14a: **Implemented locally:** all five locked text-only question types; 3–6 item Reorder with drag and accessible up/down controls; 2–5 one-to-one Match Pairs with tap-to-pair and Undo; exact position/pair partial credit composed with Live Speed and Hope; shuffled, stable presentation order; untouched Reorder drafts remain unanswered.
- B14b: **Implemented locally:** three-step Basics → Questions → Review & Publish authoring with autosave and mobile/Presenter previews; Published Draft Revision and immutable version snapshots; per-Run Presenter and Manual/Automatic Completed + Hidden state; Trainer-controlled Final Reveal; archived parent Session guard across Quiz and shared GDM new-Run/reset paths.
- Changed files / migration: `src/domain/quiz.ts`, `src/domain/quiz.test.ts`, `src/quiz-authoring.tsx`, `src/quiz-pages.tsx`, `src/quiz.css`, `src/worker/quiz.ts`, `src/worker/gdm.ts`, `scripts/quiz-smoke.mjs`, `docs/DECISIONS.md`, `docs/GDM_AUDIT.md`, `docs/BUILD_STATUS.md`; additive migration `0018_quiz_v12.sql` applied to local D1. Existing Sessions, Activities and Run ledger remain in use.
- Acceptance / regression: `npm test` passes 65 tests; `npm run smoke:quiz` passes the five-type Live/Self-paced, partial scoring, permissions, reveal, Draft Revision, pinned Presenter and archived-Session flows; `npm run smoke:gdm` passes 83 local Worker/D1 assertions; `npm run smoke` passes 1,030 cross-module assertions. `npm run load:quiz` accepted 200/200 local joins and answers with zero failures (answer burst p95 1,253.7 ms; lock acknowledgement 23.2 ms). The authoring Builder was visually spot-checked at desktop and 390 px widths. `npm run build`, `npm run typecheck`, `npm run lint`, and `git diff --check` pass. Build retains a non-blocking client chunk-size warning (>500 kB).
- Remaining: all 92 pack acceptance cases were not exercised end to end; pixel-diff review of all 21 references, remote migration/deployment, production capacity and trainer-led UAT remain unverified.

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
