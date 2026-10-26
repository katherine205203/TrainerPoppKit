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

SC-D1–SC-D6 were locked by the supplied Implementation Pack v1.1. The v1.2 scoring addendum and approved v1.3 Control Room & Presenter update replace the older presenter/privacy lifecycle decisions; all other locked decisions still apply.

| ID | Status | Decision |
|---|---|---|
| SC-D1 | LOCKED | This release contains SCARF Assessment, personal results, trainer analytics and heatmaps. It does not add separate check-in, reflection or team-heatmap activities. |
| SC-D2 | LOCKED | Activities may be standalone (`session_id = null`) or linked to an existing session. |
| SC-D3 | LOCKED | At creation the trainer must choose `immediate` or `trainer_released`; do not default silently. Freeze the choice when the activity opens or its first participant joins. |
| SC-D4 | LOCKED | The trainer/owner can inspect named individual results. SCARF is always named: the Presenter may receive named lobby status and named heatmap rows only after the trainer explicitly reveals the heatmap; it never receives raw answer records or owner controls. |
| SC-D5 | LOCKED | Support activity, session and team analytics. Session analysis uses the latest compatible submission per session participant and reports excluded incompatible versions. |
| SC-D6 | LOCKED | A participant has one current submission per activity and cannot self-retake. A trainer can explicitly reset the current attempt; reset increments its generation and is audited. |
| SC-D7 | LOCKED | Keep the 30-item bank and its three response sections. Preserve Reaction Intensity and Driver Priority; add Integrated SCARF Needs Profile as a separate derived result and heatmap source. Do not silently rescore historical records. |
| SC-D8 | LOCKED | Use v1.1 section-wise descending midranks (ties within 1e-9), `H=(5-rank)/4`, and `NeedsIndex=1+9×mean(H_R,H_B,H_T)`; rank the final five NeedsIndex values with midranks. Compare the same domain against participant-weighted class means. |
| SC-D9 | LOCKED | A SCARF Presenter Individual heatmap is revealable with one or more compatible submitted participants. Compared to Class requires at least two compatible profiles. Team view requires configured teams with at least two usable teams; there is no arbitrary minimum-five suppression. |

## SCARF implementation boundaries and remaining approvals

- The supplied English 30-item Question Bank v0.2 and v1.1 scoring are implemented as an **experimental, unvalidated** instrument. The pack does not make it an official NLI questionnaire and the app must not claim validation, norms, diagnosis or competence measurement.
- v1.1 retains the original fixed-sum Driver Priority and adds a third Integrated Needs Profile. New activities are pinned to scoring `1.1.0`; earlier records retain their stored versions and do not receive fabricated needs fields.
- v1.3 Presenter state is explicit and independent from personal-result release: Open/Present shows a live named lobby, Close shows an Activity Closed screen, and only an explicit Reveal heatmap action exposes named Needs rows. Individual reveal is allowed at n=1; class comparison and Team view have their own meaningful-data guards. Trainer analytics remain named and private behind owner authentication.
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

## Quiz Module v1.2 Update Pack decisions

The supplied Quiz Update Pack v1.2 Decision Register and State/Scoring Rules are authoritative for this module update. Their CLOSED choices take precedence over UI Atlas details; the Atlas and screenshots guide visual treatment only. These rules extend Quiz v1.0 and reuse the shared single-owner Session, Activity, Run, Participant, PIN and GDM contracts.

| ID | Status | Decision / boundary |
|---|---|---|
| QTYPE-01 | LOCKED | Exactly five text-only types: Single Choice, Multiple Choice, True/False, Reorder and Match Pairs. No fill-in-the-blank, images or media. |
| CREATE-01 | LOCKED | Authoring has three navigable steps: Quiz Basics, Focused Question Builder, and Review & Publish. Draft autosaves; previewing does not create Activity, Run, Participant or Answer records. |
| QTYPE-02 | LOCKED | Reorder uses 3–6 items; Match Pairs uses 2–5 one-to-one pairs. Partial credit is the fraction of positions/pairs correct. Legacy choice types remain all-or-nothing. |
| SC-01–SC-03 | LOCKED | Live Accuracy + Speed multiplies partial credit by the 1×–2× Speed factor; Hope ×2/×3 multiplies partial points too. Only a fully correct question counts toward the correct-question tie-break. |
| SC-04 | LOCKED | When feedback is permitted, show Correct / Partially Correct / Incorrect and earned points. A Manual Live per-question reveal exposes only that question; final score, standings and podium stay hidden until the completed Run is explicitly revealed by the Trainer. |
| QUX-01–QUX-03 | LOCKED | Reorder supports drag and accessible up/down controls. Match uses tap-left then tap-right, shows established pairs and allows Undo. Self-paced expiry or Trainer End grades saved partial work; untouched items remain unanswered. |
| QUX-04–QUX-05 | LOCKED | Changing question type requires confirmation, keeps stem/explanation and clears incompatible answer data. Self-paced question order may be shuffled per attempt; Reorder/Match presentation order is shuffled while stable IDs preserve grading. |
| AUTHOR-01–AUTHOR-02 | LOCKED | Editing a Published Quiz starts a Draft Revision based on that version. Publish creates the next immutable version; existing Runs keep their content snapshot. Builder/Review preview supports Participant Mobile and Presenter without creating a Run. |
| PRESENT-01–PRESENT-06 | LOCKED | Live completion always produces Completed + Final Results Hidden in Manual and Automatic modes. Trainer explicitly reveals final results. Presenter is pinned to a Run; an older completed Run can be revealed after a newer Run starts. New Runs rotate the Activity PIN and require fresh participant membership. At least one valid participant is required to start a Live Run. |
| GDM-QUIZ-01 | LOCKED | An archived parent Session must be reopened before creating another Quiz Run. Once the Session is reopened, the existing Quiz Activity can create its next Run under the normal sequential-run rule. |

The scoring base is `round(basePoints × accuracyRatio × speedFactor × hopeMultiplier)` with rounding once at final participant points. Speed is server-timed; Self-paced uses factor 1. New shuffled Reorder with no participant interaction is unanswered, not accidental position credit. These implementation details follow the pack's Business Rules and technical safeguards; they do not add new product decisions.

## Change log
- 2026-10-22: Initial decisions assembled from approved discussion and the supplied six-page reference PDF. No unapproved proposal promoted to `LOCKED`.
- 2026-10-22: Added SCARF Assessment pack decisions SC-D1–SC-D6. The supplied v0.2 instrument is implemented for the user-requested release but is clearly marked experimental and unvalidated.
- 2026-10-23: Added SC-D7–SC-D9 from SCARF Product Pack v1.2 and locked the v1.1 Integrated Needs scoring, legacy preservation, and presenter suppression rules.
- 2026-10-22: Added Poll v1.2 module decisions POLL-D1–POLL-D9. A-01/A-02 remain explicitly open and provisional.
- 2026-10-22: Added Reflection Wall v1.0 module decisions RW-D1–RW-D8 from its locked Decision Register.
- 2026-10-26: Added Quiz Module v1.2 Update Pack CLOSED decisions and implementation boundaries for partial scoring, Draft Revision, run-scoped Presenter, final reveal, and the archived-Session guard.
