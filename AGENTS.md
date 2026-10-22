# TrainerPopp!Kit — Instructions for Codex

> Read this file first. This repository is the source of truth for implementation, not assumptions based on old chat threads or decorative mockups.

## Product identity
- Brand: **Popp!**. Product name: **TrainerPopp!Kit**.
- A **single-owner personal facilitation web app**. Trainer creates and runs activities; participants join temporarily by QR/link/PIN and **do not register accounts**.
- A tool can run standalone (Quick Activity) or be part of a Class/Workshop (Session).
- Trainer controls whether/when results are published and exactly what appears in Presenter Mode.

## Required reading (in this order)
1. `docs/DECISIONS.md` — agreed rules vs proposals/open issues.
2. `docs/PRODUCT.md` — product scope, people and workflows.
3. `docs/UX_FLOWS.md` — trainer, participant, presenter behavior.
4. `docs/DESIGN_SYSTEM.md` + `assets/TrainerPoppKit_StyleGuide_Reference.pdf` — implementation tokens and visual reference.
5. `docs/ARCHITECTURE.md` — intended Cloudflare architecture.
6. `docs/SCARF_SPEC.md` — SCARF-specific behavior and open measurement decisions.
7. `docs/ROADMAP.md` — build batches and acceptance gates.

## Priority when instructions conflict
1. Most recent explicit product decisions documented in `docs/DECISIONS.md`.
2. Signed-off behavior/specifications from the current task and relevant `docs/*.md`.
3. Design-system tokens and interaction guidance in `docs/DESIGN_SYSTEM.md`.
4. Reference PDF/images for **visual styling only**, not functional requirements or authoritative chart numbers.
5. Safe, straightforward engineering defaults for unaddressed implementation details.

If a task conflicts with an agreed decision, identify the conflict before changing it. If an unresolved decision blocks a safe and correct implementation, implement only the non-blocked part and report the dependency; do **not** fabricate SCARF questions, scoring rules, licensing permissions or privacy consent.

## Non-negotiable rules
- Cloudflare is the target infrastructure. First candidate stack: **React + Vite + TypeScript + Cloudflare Workers + D1**. Live update v1 may use polling; Durable Objects/WebSockets only if needed.
- Preserve the approved visual direction: bold flat illustrations, vivid palette, playful shapes, warm backgrounds, clear modern UX. Avoid gradients, glossy 3D, generic AI/SaaS aesthetics.
- No participant signup/sign-in, emails, organization admin or multi-tenant trainer platform in MVP.
- Participant join token is scoped to the activity/session. A public PIN must **never** grant owner privileges.
- Owner-only pages/APIs require server-side authentication; every participant read/write request must enforce resource-level authorization.
- Named responses/profiles must not be publicly presented without an appropriate disclosure and consent flow. Presenter anonymized by default for individual data.
- Scoring, question items and percentile thresholds must be versioned and clearly labelled. A high SCARF score is **not** a judgement of competence or goodness.
- Mock figures are sample UI only; do not use as official SCARF data or claim psychometric validation.
- Keep modules lightweight and evolvable: one app first, no premature microservices/plugin marketplace/no-code platform.

## Delivery contract for every Codex task
1. Explain briefly which files/modules will change and which decisions they implement.
2. Write functioning UI and backend logic (avoid fake buttons or demo-only workflows when asked to implement a feature).
3. Include meaningful loading / empty / failure / recovery states.
4. Test happy paths **and** permission/data-isolation edge cases; use migrations for schema changes.
5. Keep secrets out of source control and logs. Do not expose participant raw answers through unrestricted APIs.
6. Summarize what was implemented, tests actually run, open issues and any changed documentation.
7. Update `docs/ROADMAP.md` when a batch is completed; update `docs/DECISIONS.md` only for decisions explicitly agreed, otherwise add an open question.

## Suggested development commands
The repository has no scaffold yet. Establish package scripts during Batch B01 (`dev`, `build`, `test`, `typecheck`, `lint`, `db:migrate`). Never assume these already exist.


## Approved screen index
- `docs/UI_REFERENCE_INDEX.md` enumerates 15 agreed PNG references in `assets/ui-references/`. Review these before building relevant pages.
- See `CODEX_AUTOBUILD_PROMPT.md` for one-shot build goals and `docs/BUILD_STATUS.md` for resumption checkpoints.
