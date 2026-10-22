# Product decisions — TrainerPopp!Kit

**Version:** 1.0 · 2026-10-22
**Legend:** `LOCKED` = user explicitly selected/agreed · `PROPOSED` = recommended approach, subject to implementation review · `OPEN` = not decided.

| ID | Status | Decision / boundary |
|---|---|---|
| D-001 | LOCKED | Main brand is **Popp!**; the product is named **TrainerPopp!Kit**. |
| D-002 | LOCKED | The web app is owned/operated by **one trainer**. No participant accounts. |
| D-003 | LOCKED | Participants join by **QR/link/PIN**, identify themselves, then use an activity on mobile. |
| D-004 | LOCKED | A tool can be a standalone Quick Activity **or** included in a Class/Workshop. |
| D-005 | LOCKED | Trainer determines participant result visibility: immediate, after trainer reveals, or confirmation only. |
| D-006 | LOCKED | Trainer may present in the dashboard or control a distinct Presenter screen. |
| D-007 | LOCKED | Groups are optional. Participants can select a group, trainer can assign/reassign, or no groups are used. |
| D-008 | LOCKED | Future expansion uses both an easy builder for simple activities and custom modules for specialized tools. **The builder is not MVP.** |
| D-009 | LOCKED | **SCARF** is the first tool; it supports personal interpretation and comparison to the group/team, including heatmap views. |
| D-010 | LOCKED | Design direction from the six-page StyleGuide: vivid flat palette, warm off-white, friendly geometric shapes/characters; modern and non-generic. |
| D-011 | LOCKED | **Cloudflare** is the hosting/platform choice, starting small and scaling when demand is known. |
| D-012 | LOCKED | Personal use is primary **now**; commercial/public expansion beyond one owner is uncertain and not in MVP. |
| D-013 | PROPOSED | Architecture: React + Vite + TypeScript app, Cloudflare Workers for frontend/API, D1 for SQL; start with polling for trainer/presenter, add Durable Objects if needed. |
| D-014 | PROPOSED | One repository and lightweight modular monolith; no complex plugin framework, organizations or microservices. |
| D-015 | PROPOSED | Default to anonymized named-profile presentation until participant disclosure and consent requirements are satisfied. |
| D-016 | PROPOSED | First development release should culminate in SCARF end-to-end usable in a real class. |

## Open decisions — do not silently invent

1. **SCARF item set and usage rights:** the exact approved questions, wording, languages, response scales, source/license and permissible adaptations are not yet provided.
2. **SCARF scoring:** dimension calculation, treatment of missing/invalid responses, reverse coding (if any), consistency checks, rounding and profile interpretation require approval.
3. **Relative comparison:** within-person score-vs-rank/percentile method, between-person/team comparison, ties, minimum group size, visibility of small groups and group changes are not yet approved mathematically. P25/P75 is a user-suggested example, **not final**.
4. **Privacy and consent:** finalize opt-in text and participant view of names, per-person vs aggregate disclosure, and deletion/retention policy before real workshops.
5. **Owner authentication:** select and implement a secure single-owner sign-in approach suitable for a public participant site.
6. **Brand assets:** update PDF's old product name and confirm whether mascots/icons are final reusable vectors or still raster references.
7. **Language:** UI language choice (Vietnamese, English, bilingual) and localizations are not yet locked.
8. **Session join:** whether PIN is always required after scanning QR or configurable is not yet explicitly fixed; make configurable if it does not complicate MVP.
9. **Retakes / edited submissions:** determine whether participants can edit after submit or resume using a time-limited token.

## Change log
- 2026-10-22: Initial decisions assembled from approved discussion and the supplied six-page reference PDF. No unapproved proposal promoted to `LOCKED`.
