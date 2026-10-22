# Implementation roadmap — build in small verified batches

**As of 2026-10-22:** Concept and StyleGuide are agreed. Implementation has **not started**. Estimates and schedules are deliberately omitted; track completed tests, not invented percentages.

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
- B04a: **Use demo data only** to implement questionnaire renderer and UI while waiting for approved item bank/scoring.
- B04b: once approved, implement versioned item set, scoring, data persistence, individual result and tests.
- Acceptance: correct scoring against agreed fixtures; five dimensions correctly labeled; privacy enforced.

## Phase 05 — Live results / Presenter
- B05a: trainer progress, reveal policy, group summary and heatmap in two modes.
- B05b: presenter same-screen and separate-screen; server-controlled publication, named/anonymous safeguards and polling sync.
- Acceptance: controlled demonstration of a realistic 20–50-person session; participant data remains private until permitted; views and team filters give correct calculations; viewer can recover from disconnect.

## Phase 06 — Stabilization, then expansion
- B06a: exploratory load tests, D1 limit checks, backups/recovery, accessibility, logs, low-cost hosting monitoring.
- B06b (later): Reflection/Learning Behavior as **second distinct tool** to prove modular approach; simple builder after needs are validated.
- Acceptance: one real trainer-led class succeeds end-to-end; meaningful defects tracked and resolved; next tool does not require redesigning core session/join/presenter models.

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
