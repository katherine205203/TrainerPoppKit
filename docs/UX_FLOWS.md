# UX flows and screen contract

## Shared navigation
Owner navigation (initial proposal): Home; Tool Library; Sessions; Live Activities; Archive/Results; Settings. Avoid adding participant account menus or organization administration.

## 11 primary screen families

| # | Screen | Core content and actions |
|---|---|---|
| 01 | Home Dashboard | Recent activities, upcoming sessions, quick launch a tool, status |
| 02 | Tool Library | Available tools; first entry SCARF; clear template/type |
| 03 | Tool Detail | Purpose, duration indication if grounded, quick run vs add to session |
| 04 | My Sessions | Browse/create/open class or workshop |
| 05 | Session Detail | Session info, activities, optional roster and teams |
| 06 | Activity Setup | Tool options, join settings, identity, teams, result policy, preview, launch |
| 07 | Join Activity (mobile) | QR landing/PIN, join errors, display name, optional team selection |
| 08 | Activity Runner (mobile) | Progress, questions, save/resume, next/back, submit |
| 09 | Submission Result (mobile) | Immediate own result OR wait for reveal OR thank-you only |
| 10 | Live Activity Dashboard (owner) | Counts, participant/team progress, close/reopen controls, preview results |
| 11 | Presenter Mode | Reveal/hide, heatmap, filters, named/anonymous when allowed, fullscreen |

## Flow A — Quick Activity
Owner Home/Tools → choose SCARF → Configure Activity → Generate join link + QR + optional PIN → Open Activity → Participants join → Respond → Owner monitors → Owner reveals/selects present view → Close and archive.

## Flow B — Class/Workshop
Owner Sessions → Create Session → Add one or more activities → Optional roster/group planning → Start selected activity → Guests join (can share an attendance identity within session only if implemented explicitly) → Presentation → Repeat for next activity → Archive.

## Flow C — Guest
1. Open join link / QR, or navigate to generic join with PIN.
2. Validate session/activity exists, is open and guest limit not exceeded.
3. Enter display name and team if enabled (or remain unassigned for trainer assignment).
4. Receive scoped, revocable guest session token; no password or signup.
5. Complete tool with progress indicator and safe back/forward or recovery handling.
6. Submit once; repeated tap / retry must not duplicate final data.
7. Follow owner's visibility policy. If waiting, do not leak result in API responses or client bundle.

## Flow D — Trainer/presenter control
Trainer can keep result reveal off during collection, then decide to show aggregate, personal pattern or relative-to-team. Presenters launched in separate browser tabs/windows must reflect owner-controlled presentation state through polling v1 or a later real-time transport. Guests cannot control presentation state.

## Common states and edge cases
- **Join:** invalid PIN, expired/closed activity, revoked link, exceeded limit, duplicate display name, reconnect.
- **Runner:** loading, no connection, unsaved progress, partial answer, refreshing/reopening browser, submit pending, retry after ambiguous success.
- **Trainer:** no participants, some incomplete, response comes after closure, filter changes, corrected team assignment, hidden private data.
- **Presenter:** neutral waiting state, incomplete stats, unsupported percentile due to sample size, projection-safe display, losing/recovering sync, insufficient consent to show names.
- **Archive:** no accidental reopen, retained/exported data explained clearly; deletion semantics defined before real data use.

## Layout behavior
- Owner: desktop-first, responsive at laptop widths; may display live status with cards/filters.
- Guest: mobile-first, focused single-task navigation, large accessible tap targets, minimal distractions.
- Presenter: presentation-first 16:9-safe views, larger titles/labels, fewer controls shown on projected display, accessible legends; no decorative mascots over heatmaps.

## Accessibility defaults (proposed)
- Avoid color-only meaning; include labels, numeric values or legends.
- Text and controls must have sufficient contrast; test UI on projector, mobile and under sunlight.
- Keyboard and focus states supported on owner UI; touch targets comfortably sized for mobile.
- Reduced-motion preference should suppress decorative bounce, sparkle or slide effects.
