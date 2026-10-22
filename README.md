# TrainerPopp!Kit

A trainer-owned facilitation workspace for sessions and interactive activities. Trainers can create a session or quick activity; participants join from a QR code, link, or six-digit PIN without creating accounts. The trainer controls result visibility and presenter output.

The first module is a **SCARF demonstrator**. All questions and scoring are labeled DEMO and remain experimental. This app does not include official SCARF items or claim validated psychometric results.

## Run locally

Requirements: Node.js 22 or later and npm.

```sh
npm install
npm run local:setup
npm run db:migrate
npm run dev
```

Open the local URL printed by Vite. `npm run local:setup` creates ignored `.dev.vars` with a random owner password and signing secret. Open that file locally to read the owner password; it is not printed to the terminal and must not be committed.

## Verify changes

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run smoke
```

`npm run smoke` exercises the local Worker and D1 via `http://127.0.0.1:8787`; start the dev server there first, or set `TRAINERPOPP_SMOKE_URL` to another local URL. The smoke suite uses generated demo records.

## Cloudflare deployment

Deployment uses a Cloudflare Worker with static assets and a D1 database. Complete Wrangler browser login, create a new production D1 database, replace the placeholder `database_id` in `wrangler.jsonc`, and apply migrations to that new database before setting production secrets and deploying.

Never apply destructive migrations to production. Set `OWNER_PASSWORD` and `SESSION_SECRET` with Wrangler’s secret prompts, without placing either value in shell history or source control. The public `workers.dev` deployment is suitable for demo content only until the owner password is set and verified.

## Product and design context

- Start with [`AGENTS.md`](AGENTS.md) and [`docs/DECISIONS.md`](docs/DECISIONS.md).
- Product and participant flows: [`docs/PRODUCT.md`](docs/PRODUCT.md), [`docs/UX_FLOWS.md`](docs/UX_FLOWS.md).
- Design and approved visual references: [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md), [`docs/UI_REFERENCE_INDEX.md`](docs/UI_REFERENCE_INDEX.md), and [`assets/TrainerPoppKit_StyleGuide_Reference.pdf`](assets/TrainerPoppKit_StyleGuide_Reference.pdf).
- Build progress and resumable deployment checklist: [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md).
