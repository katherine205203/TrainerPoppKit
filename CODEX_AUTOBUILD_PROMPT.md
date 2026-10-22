# TrainerPopp!Kit — autonomous local build / deployment

You are the primary engineer and implementation agent for **TrainerPopp!Kit**. Work directly within this existing macOS folder:

`/Users/katherinebui/Documents/TrainerPopp!Kit`

**Goal:** build, run, test and, when safely possible, deploy a working single-owner trainer facilitation web app on Cloudflare, using the approved project docs and all 15 approved visual references. Perform all steps you can autonomously. The user handles authentication in browser, OS permissions, and approvals for charges/destructive or data-exposing actions; do not ask the user to perform routine terminal/config tasks.

## Phase 0 — inspect and load project context
1. Confirm the current working directory is exactly the path above. Do not create a nested `trainerpopp-kit/` within it.
2. Inspect the folder **without deleting or overwriting anything**. If `TrainerPoppKit_Codex_Autobuild_Package.zip` is present and the context files have not yet been extracted, extract it safely into the folder, preserving existing unrelated files. If the files are already present, use them directly. If the archive is missing, report the missing source; do not invent visual references or claim to have read them.
3. Read `AGENTS.md`, `START_HERE.md`, all `docs/*.md`, `docs/UI_REFERENCE_INDEX.md`, and review all 15 actual PNGs in `assets/ui-references/` plus the supplied StyleGuide PDF. Keep an index of what you actually opened. The PDF/PNG mockups are visual references, not authorized questionnaire definitions or backend specifications.
4. Scan the environment for Node/npm, Git, GitHub CLI, Wrangler, Cloudflare authentication and the existing git state. Install project dependencies as required, using available tooling. Ask for user intervention only when the OS or third-party browser authentication demands it. Never print or commit credentials.

## Work style
- Make a brief plan, then EXECUTE it rather than stopping at a plan.
- Work through milestones in order. After every milestone run relevant checks, commit code to git if configured, and update `docs/BUILD_STATUS.md` with commands, test outcomes, limitations, next step and precise milestone status. You may update `docs/ROADMAP.md` as implementation progresses.
- Continue into the next milestone automatically if safe and feasible. If the session ends, ensure the repo and BUILD_STATUS make continuation easy; the user should be able to say only “Continue from BUILD_STATUS.md”.
- Use reasonable implementation defaults when an unresolved choice is not consequential. Do not expand scope into commercial multi-tenant SaaS, participant accounts or no-code builder.
- Do not treat mock data as real data. Every demo-only visual and fake result must be explicitly marked DEMO.
- Prefer simple, testable architecture over abstractions. Keep architecture portable where practical.

## Target architecture
- React + Vite + TypeScript SPA with Cloudflare Workers API in one project using the maintained Cloudflare Vite integration, guided by up-to-date official Cloudflare documentation. React Router, accessible custom design system components; ECharts if useful.
- Cloudflare D1 database; schema SQL migrations under version control, local/dev/prod separation if needed. Never apply destructive migrations to prod.
- Single owner, secure server-side authentication. Temporary anonymous **participant session** via QR/link/PIN must be scoped to the activity, not general database or owner privileges.
- First live dashboard version can use sensible polling; Durable Objects and WebSocket are NOT required until real product needs justify them.
- GitHub private repo `trainerpopp-kit` may be created from this folder using `gh` if available, user authorizes login and no repo collision. Never make repo public without asking.
- Cloudflare Workers deploy can be done with Wrangler after the user completes `wrangler login`; respect least privilege and free-tier preference.

## Milestones and acceptance
M0 Environment / integrity:
  - All context and 15 UI refs discovered; setup commands work; no user files clobbered; plan written.
M1 App scaffold:
  - React/TS/Vite + Cloudflare Workers project created in current folder, scripts dev/build/test/typecheck, proper `.gitignore`, working local dev and successful build; React Router and secure API baseline.
M2 Popp! design foundation:
  - Tokens match approved palette, Plus Jakarta Sans, custom FLAT SVG shape/mascot/icon primitives, Electric Blue trainer sidebar, responsive base, accessibility. No generic default dashboard, no emojis as replacements, no gradients/glass/neumorphism.
M3 Trainer screens:
  - Functional navigation and meaningful states for Home, My Tools, Tool Detail, My Sessions, Session Detail, Create/Edit Session, Activity Setup, Live Activity, Archive/Results, Result Detail/Analytics, Presenter Mode. Keep visual references named and QA against them.
M4 Participant mobile screens:
  - Join Activity, Participant Info, Assessment/Activity, Done/Waiting/Personal Result, all responsive and stateful. No participant account/navigation; show results only as configured by trainer.
M5 Core application logic:
  - D1 schema, Sessions optional, Quick Activities standalone, Activity, temporary participant identity, teams, QR and PIN, join token, draft/submission, owner controls, owner-only operations, result visibility policy, safe retries/idempotent submissions, loading/errors/offline-recovery where feasible.
M6 SCARF module demonstrator:
  - SCARF 5 **correct** labels Status/Certainty/Autonomy/Relatedness/Fairness; UX for 5 dimensions, score display, Within-person vs Relative-to-team heatmap toggle, group filters, P25/P75 concept with small-group/tie warnings; presenter explicit reveal/hide, anonymous by default. Because questionnaire/scoring are not yet approved, use clearly labelled DEMO fixtures and block production questionnaire/scoring until approved. Do not fabricate professional validation or licensed SCARF items. Treat rating content as demonstration only. Make the generic engine ready to accept approved items later.
M7 Testing / deploy:
  - Tests for public vs owner access isolation, PIN guessing/rate limits, submission retries, scoped participant tokens, named-results disclosure, session ownership, join and presentation flows, D1 migrations and relevant UI states; run lint/typecheck/build/smoke checks; deploy Cloudflare preview and production Worker if authorized and no privacy/billing risk; return exact tested URLs and environment status. Do not falsely report success if auth or deployment prevented it.

## Safety / approval gates
**Proceed without asking** for normal coding, package installation within project, scaffolding, tests, local git init, local D1 dev migrations, generating mock fixtures and non-destructive config changes.
**Pause ONLY when required** for: GitHub/Cloudflare/OS login, granting elevated access, actual paid-plan upgrade/billing, destructive changes to existing user data, exposing private data, making a private repository public, assigning a public custom domain, changing approved product/design decisions, using official SCARF question content without permission.
Cloudflare default `*.workers.dev` free-tier test deployment is authorized provided owner APIs are protected and no real participant data is exposed. Do not bypass authentication for speed.
If a milestone is blocked by approvals, continue other independent safe tasks.

## Final report
- What was implemented (with milestone status DONE / PARTIAL / BLOCKED)
- Local dev command and URL, test commands/results
- GitHub private repo URL (if created)
- Cloudflare Worker URL (if actually deployed), D1 environment(s) and status
- Unresolved SCARF measurement/content/privacy decisions
- Concrete next step, not a vague promise

Start by inspecting the exact local folder and context archive, then execute M0 → M7 autonomously as far as safe. No need to ask me for general planning approval.
