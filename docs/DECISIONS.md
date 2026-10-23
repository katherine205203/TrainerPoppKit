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

## SCARF Assessment decisions

SC-D1–SC-D6 were locked by the supplied Implementation Pack v1.1. The v1.2 Product Pack scoring addendum replaces only the result/scoring/heatmap decisions; all other locked decisions still apply.

| ID | Status | Decision |
|---|---|---|
| SC-D1 | LOCKED | This release contains SCARF Assessment, personal results, trainer analytics and heatmaps. It does not add separate check-in, reflection or team-heatmap activities. |
| SC-D2 | LOCKED | Activities may be standalone (`session_id = null`) or linked to an existing session. |
| SC-D3 | LOCKED | At creation the trainer must choose `immediate` or `trainer_released`; do not default silently. Freeze the choice when the activity opens or its first participant joins. |
| SC-D4 | LOCKED | The trainer/owner can inspect named individual results. Presenter access is aggregate-only and must never receive participant rows or identifiers. |
| SC-D5 | LOCKED | Support activity, session and team analytics. Session analysis uses the latest compatible submission per session participant and reports excluded incompatible versions. |
| SC-D6 | LOCKED | A participant has one current submission per activity and cannot self-retake. A trainer can explicitly reset the current attempt; reset increments its generation and is audited. |
| SC-D7 | LOCKED | Keep the 30-item bank and its three response sections. Preserve Reaction Intensity and Driver Priority; add Integrated SCARF Needs Profile as a separate derived result and heatmap source. Do not silently rescore historical records. |
| SC-D8 | LOCKED | Use v1.1 section-wise descending midranks (ties within 1e-9), `H=(5-rank)/4`, and `NeedsIndex=1+9×mean(H_R,H_B,H_T)`; rank the final five NeedsIndex values with midranks. Compare the same domain against participant-weighted class means. |
| SC-D9 | LOCKED | Presenter aggregates require at least five compatible, released participants. If any team has fewer than five, suppress the whole team breakdown and complementary values while retaining the safe overall result when its cohort is at least five. |

## SCARF implementation boundaries and remaining approvals

- The supplied English 30-item Question Bank v0.2 and v1.1 scoring are implemented as an **experimental, unvalidated** instrument. The pack does not make it an official NLI questionnaire and the app must not claim validation, norms, diagnosis or competence measurement.
- v1.1 retains the original fixed-sum Driver Priority and adds a third Integrated Needs Profile. New activities are pinned to scoring `1.1.0`; earlier records retain their stored versions and do not receive fabricated needs fields.
- Presenter cohorts require at least five distinct submitted participants. When a small team could be inferred by subtraction, team drilldowns are suppressed. Trainer analytics remain named and private behind owner authentication.
- Participant-facing content is English in this release. Vietnamese localization is deferred.
- The global owner sign-in implementation and existing QR/link/PIN contract are implemented in the app; production secrets still require deployment setup.

## Poll Module v1.2 decisions and assumptions

The Poll Product Specification v1.2 is the implementation baseline for Poll. These module decisions are scoped to Poll and reuse the shared single-owner Session, Activity, Participant, team, PIN/link, Archive and Presenter infrastructure.

| ID | Status | Decision / boundary |
|---|---|---|
| POLL-D1 | LOCKED | A Poll contains one question, Single or Multiple Choice, 2–10 total options, optional “Other” text up to 150 characters, and a configured selection limit. |
| POLL-D2 | LOCKED | Polls may be standalone or linked to an existing Session; multiple Polls may be Live in one Session. |
| POLL-D3 | LOCKED | Participants enter by direct Poll QR/link/PIN or a shared Session QR/link/PIN. Session identity/team is reused across its Polls. Anonymous standalone Polls require no name. |
| POLL-D4 | LOCKED | A participant has one effective response per Poll; a Live response can be edited, and retrying the same idempotency key does not create another vote. |
| POLL-D5 | LOCKED | Poll lifecycle is Draft, Live, Closed and Reopened. Closing blocks vote changes; reopening preserves existing valid responses. Reveal/Hide is independent of lifecycle. |
| POLL-D6 | LOCKED | Trainer analytics can show Anonymous completion status separately from answers. Named mode allows owner-only individual response review. Anonymous answer mappings are not exposed. |
| POLL-D7 | LOCKED | Participant results are configured as Presenter only or Presenter + participants after Reveal. Presenter Mode is aggregate-only and respects Reveal state. |
| POLL-D8 | LOCKED | Results use respondents as the percentage denominator; Multiple Choice percentages may total over 100%. CSV is safe against spreadsheet formula injection and respects Anonymous/Named mode. |
| POLL-D9 | LOCKED | Duplicate creates a clean Draft without responses or an active join PIN. Poll data is independently persisted and controlled within the existing activity/session architecture. |

### Unconfirmed Poll assumptions (do not promote to LOCKED)

| ID | Status | Provisional behavior implemented |
|---|---|---|
| A-01 | OPEN | A Poll may reopen while its parent Session remains archived; other Session activities remain untouched. |
| A-02 | OPEN | The original Poll URL, QR and PIN remain valid and usable when the Poll is reopened. |

The implementation follows A-01/A-02 only as the specification's provisional behavior. Confirm both with the product owner before treating them as final policy.

## Reflection Wall v1.0 decisions

The supplied Reflection Wall v1.0 Decision Register is authoritative for this module. These constraints apply only to Reflection Wall and reuse the shared single-owner Activity/Session infrastructure.

| ID | Status | Decision / boundary |
|---|---|---|
| RW-D1 | LOCKED | A wall has 1–4 trainer-defined columns; title, prompt, Post-it and comment lengths are bounded by the product specification. Each participant may publish 1–10 Post-its across the entire wall (default five). |
| RW-D2 | LOCKED | Post-its appear immediately after publication. There is no reveal gate; the trainer can hide and restore content. |
| RW-D3 | LOCKED | Anonymous actors use wall-scoped opaque capabilities and are not linked to a Session participant, team or name. Named mode stores only the participant-selected display-name snapshot and is fixed after first publication. |
| RW-D4 | LOCKED | Six reactions are available on Post-its and comments; participants may select multiple reaction types and retries are idempotent. Comments are flat. Authors edit/delete their own content while Open; trainers hide/restore. |
| RW-D5 | LOCKED | Clusters are virtual and reversible; each Post-it may be in at most one cluster and retains its source column. |
| RW-D6 | LOCKED | Lifecycle is Draft/Open/Paused/Closed/Archived. A closed or archived wall is read-only for participants; reopening retains content and its join access. Reopen the parent Session first if it is completed. |
| RW-D7 | LOCKED | Presenter is a separate short-lived capability with Off, All, Focus, Spotlight, Cluster and Blank modes. Off/Blank payloads reveal no wall content or analytics; Presenter never receives participant identities. |
| RW-D8 | LOCKED | Realtime synchronization uses persisted D1 content-free event cursors and short polling, consistent with the current Worker/D1 architecture and without a new realtime service. |

The participant experience is mobile-first; the trainer workspace is desktop-oriented and follows the existing Popp! visual system. The pack's question/content is trainer-authored rather than a published assessment instrument.

## Change log
- 2026-10-22: Initial decisions assembled from approved discussion and the supplied six-page reference PDF. No unapproved proposal promoted to `LOCKED`.
- 2026-10-22: Added SCARF Assessment pack decisions SC-D1–SC-D6. The supplied v0.2 instrument is implemented for the user-requested release but is clearly marked experimental and unvalidated.
- 2026-10-23: Added SC-D7–SC-D9 from SCARF Product Pack v1.2 and locked the v1.1 Integrated Needs scoring, legacy preservation, and presenter suppression rules.
- 2026-10-22: Added Poll v1.2 module decisions POLL-D1–POLL-D9. A-01/A-02 remain explicitly open and provisional.
- 2026-10-22: Added Reflection Wall v1.0 module decisions RW-D1–RW-D8 from its locked Decision Register.
