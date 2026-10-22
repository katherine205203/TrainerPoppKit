# Approved UI reference index — TrainerPopp!Kit

These are **15 static visual references** approved for overall direction, not coded screens or verified business rules. Implement responsive layouts and functional states. Some texts/dates/counts and demo chart scores are decorative; no fake production results. Brand name and canonical SCARF dimensions are defined by docs, not screenshots.

| # | Reference | Area |
|---|---|---|
| 01 | `assets/ui-references/01_home.png` | Home |
| 02 | `assets/ui-references/02_my_tools.png` | My Tools |
| 03 | `assets/ui-references/03_tool_detail.png` | Tool Detail — SCARF |
| 04 | `assets/ui-references/04_my_sessions.png` | My Sessions |
| 05 | `assets/ui-references/05_session_detail.png` | Session Detail |
| 06 | `assets/ui-references/06_create_edit_session.png` | Create/Edit Session |
| 07 | `assets/ui-references/07_activity_setup.png` | Activity Setup |
| 08 | `assets/ui-references/08_live_activity.png` | Live Activity |
| 09 | `assets/ui-references/09_archive_results.png` | Archive/Results |
| 10 | `assets/ui-references/10_result_analytics.png` | Result Detail / Analytics |
| 11 | `assets/ui-references/11_presenter_mode.png` | Presenter Mode |
| 12 | `assets/ui-references/12_join_activity.png` | Join Activity (mobile) |
| 13 | `assets/ui-references/13_participant_info.png` | Participant Info (mobile) |
| 14 | `assets/ui-references/14_assessment_screen.png` | Assessment / Activity Screen (mobile) |
| 15 | `assets/ui-references/15_done_waiting_personal_result.png` | Done / Waiting / Personal Result (mobile) |

## Implementation invariants

- Desktop owner UI: persistent vivid Electric blue sidebar with custom Popp! shape icons; flat graphic blocks, warm canvas, distinctive character art; **not** generic gray-line icon dashboard.
- Presenter: no admin sidebar, projection-grade legibility, owner controls not publicly exposed.
- Participant: streamlined mobile-first QR/PIN/no-login journey; never show authenticated user navigation.
- Color palette and font in `docs/DESIGN_SYSTEM.md`; prefer licensed, implementation-ready SVGs/components based on references; do not copy a whole screenshot as the UI.
- Operational screens may be visually quieter than the Home/Tools banners for clarity but stay recognizably Popp!.
- Do not interpret illustrative question wording as a validated SCARF assessment or reference chart values as genuine analytics. See `docs/SCARF_SPEC.md`.
