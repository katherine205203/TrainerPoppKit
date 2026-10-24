# Global Data Management v1.0 — implementation audit

**Authority:** `TrainerPoppKit_GDM_Decision_Register_v1.0_2026-10-23.md` (36 finalized decisions).
**Implementation review:** 2026-10-23. Local code and D1 were reviewed; no remote deployment or production database was changed.

## Implementation shape

The app remains the existing React/Vite SPA and authenticated Cloudflare Worker/D1 service. Additive migrations `0013_global_data_management.sql` and `0014_stable_activity_access.sql` introduce a shared Run ledger, immutable Session origin/config snapshots, stable Activity access slugs, Session access generations, soft deletion, Trash manifests, audit events and operation idempotency. Quiz Run IDs map to the shared ledger; other modules retain their existing activity-scoped tables and snapshot results into the shared Run history when a Run is replaced or closed.

Owner routes are under `/api/owner/gdm/*`; Archive/Results, Session data, Activity Run controls, Run result history and Trash use the existing app shell/components. Participant access continues through each module's scoped current-Run capability and stable Activity URL. Session archive stores a fixed source-Run manifest. The scheduled Worker purge removes expired Trash packages and dependent data.

## Decision-by-decision audit

| Decision | Status | Implementation evidence |
|---|---|---|
| GDM-01 Reset Current or All Activity Runs | Implemented | Activity controls and owner reset API; Current and All scopes. |
| GDM-02 Start New Run; preserve history | Implemented | New immutable Run ID/sequence, snapshot old results, rotate PIN. |
| GDM-03 Both Session reset branches | Implemented | Keep Activities with Current/All origin-scoped reset, or detach Activities and keep Session empty. |
| GDM-04 Block destructive work while Live/Paused | Implemented | Server-side guards cover Session children and module Live/Paused states; UI controls are disabled. Reset/New Run/Delete/Restore and each purge package use a single D1 transactional batch. |
| GDM-05 Stable Activity URL/QR; stale Run access is isolated | Implemented | Stable `access_slug`, Current Run routing, rotated PIN and module-specific Run capabilities. |
| GDM-06 30-day Trash and automatic purge | Implemented | Trash manifest/expiry schema, restore UI, Worker scheduled purge (`03:17 UTC` daily). |
| GDM-07 Scoped Activity/Run/Session and Archive bulk exports | Implemented | CSV and Excel-readable `.xls` export at Run/Activity/Session scopes and selected Archive scopes; selection deduplicates Run IDs. |
| GDM-08 Reset cannot be restored | Implemented | Reset marks Runs permanently deleted, clears their snapshots and removes them from Trash manifests. |
| GDM-09 Session reset targets Current or All Runs from that Session | Implemented | Reset selects immutable `origin_session_id`; other-origin Runs are preserved. |
| GDM-10 Keep-empty reset detaches Activities and preserves Runs | Implemented | Activities become Standalone while Run origin/provenance remains. |
| GDM-11 Reset/New Run rotates PIN but keeps stable links | Implemented | Activity and Session PIN rotation does not change stable access slug. |
| GDM-12 Reset creates a new Run ID | Implemented | Old Run is permanently removed; a fresh sequential Run is created. |
| GDM-13 No Activity edits while Live; Run config snapshot is frozen | Implemented | Live guards and per-Run config/question snapshots preserve prior history. |
| GDM-14 Archived parent Session does not block Activity New Run/Reopen | Implemented | Activity controls work independently; Session remains archived and Session join remains disabled. |
| GDM-15 Trainer-only history; participant Current Run only | Implemented | Owner-authenticated Run routes; module guest capabilities remain scoped to their active Run. |
| GDM-16 Delete one Run to Trash | Implemented | Per-Run Delete action and 30-day restore package. |
| GDM-17 At most one Live Run per Activity | Implemented | One shared Current pointer, Live guards and Quiz's unique active/current constraints. Different Activities remain independent. |
| GDM-18 Archived Session join is disabled; direct Activity access remains | Implemented | Session status guard and stable Activity join route. |
| GDM-19 Session membership is reused only after opening Activity; Quiz fresh join | Implemented | Existing module join behavior retained; Quiz participants are Run-scoped. |
| GDM-20 Session reset retains URL, rotates PIN, revokes old identities | Implemented | Stable Session access slug, generation/PIN rotation and membership deletion. |
| GDM-21 Delete Session Only detaches; restore empty Session | Implemented | Session-only manifest, Activity detachment and empty-Session restore. |
| GDM-22 Old Runs cannot be reopened after a new Run | Implemented | New Run transition marks prior Run history-only; no historical participant route. |
| GDM-23 Deleting Current Run leaves no Current Run | Implemented | Current pointer and PIN are cleared; trainer must explicitly start another Run. |
| GDM-24 Restored Run returns to history | Implemented | Restore does not set Current or Live. |
| GDM-25 Activity Delete includes all Runs in one package | Implemented | Activity tombstone and complete Run manifest restore together. |
| GDM-26 Activity restore preserves stable link but not old PIN | Implemented | Access slug survives; PIN is null until a new Run is activated. |
| GDM-27 Reset archived Activity creates a clean Run | Implemented | Reset discards archived source data and creates a fresh Run using module lifecycle rules (Quiz starts its lobby). |
| GDM-28 Session + Activities Delete restores full manifest | Implemented | Session bundle manifest drives package restore; cascade is previewed. |
| GDM-29 Session reset cannot delete Runs from another origin | Implemented | Immutable origin query plus domain/Worker assertions. |
| GDM-30 Archived Session source report stays fixed | Implemented | Archive manifest freezes source Run IDs; missing/reset/deleted data is represented as unavailable instead of replaced by future Runs. |
| GDM-31 Detached Run keeps original Session provenance | Implemented | `origin_session_id` and `origin_session_name` are independent of current Activity placement. |
| GDM-32 Closed Current Run can be read-only where tool policy allows | Implemented | Current Run continues through existing module result/review policy; history remains inaccessible to participants. |
| GDM-33 Activity counts as joined only when opened | Implemented | Activity membership remains created by module open/join endpoints, not Session roster creation. |
| GDM-34 Reset All includes Runs already in Trash | Implemented | Reset scope includes soft-deleted Runs and invalidates/removes their restore manifests. |
| GDM-35 Exports respect each module's anonymity rules | Implemented | Run export delegates to each module's export policy; Poll anonymous export excludes participant identity, while named mode includes it. |
| GDM-36 Bulk Delete preview and cascade deduplication | Implemented | Archive selections support Session/Activity/Run, preview active/cross-Session impact, normalize duplicate cascades, and require confirmation. |

## Remaining technical limitations

- **Operation receipt window:** the data transaction and the `gdm_operations` DONE receipt are separate. If the Worker stops after the transaction commits but before saving its receipt, reusing that operation ID returns a conflict; the committed state remains inspectable, and the trainer can refresh before issuing a new action. This does not leave a partial Run/trash cascade.
- **Excel format:** `.xls` downloads are HTML tables readable by Excel, not native `.xlsx` workbooks. CSV remains available.
- **Operational validation:** local D1/Worker checks do not certify Cloudflare production migrations, scheduled purge timing, backups/recovery or a live workshop. Those were not run as part of this request.

## Verification performed

- `npm test` — 11 files, 63 tests passed.
- `npm run smoke:gdm` — 83 local Worker/D1 assertions, including Live guard, stable link and PIN rotation, current/history isolation, permanent reset of Trash data, Session provenance/detachment/restore, Activity restore, named/anonymous and bulk export scope, and expired Trash purge.
- `npm run smoke:quiz` — owner/access checks, Manual/Automatic, six-person Workshop, fresh Run isolation, Self-paced, CSV privacy, Presenter privacy and archived-Session behavior passed.
- `npm run smoke` — 1,023 local Worker/D1 cross-tool regression assertions passed.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed. Build reports the existing non-blocking client chunk size warning (>500 kB).

All 36 product decisions have local implementation paths. Production migration/UAT, backup/recovery and purge timing still need live Cloudflare verification; the implementation is locally verified only.
