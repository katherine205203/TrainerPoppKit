# Product specification — TrainerPopp!Kit

## Product statement
A lightweight **personal web app for a trainer/facilitator** to prepare, run and present interactive activities in real workshops. The trainer owns the workspace, invites participants into temporary activity runs without accounts and uses the results to facilitate discussion.

## Three experiences

### A. Trainer (the single owner)
- Signs in to a private owner dashboard.
- Sees the Tool Library and recent Sessions / Quick Activities.
- Launches a tool directly, or creates a Class/Workshop and adds one or more activities.
- Sets access (QR/link/PIN), participant identity fields, optional teams and how/when results appear.
- Observes participant progress, handles late joiners, opens/closes activity and decides what to present.
- Saves activity results/history for future reference.

### B. Participant (guest; phone-first)
- Joins through QR, link or PIN; **no account creation**.
- Provides a display name; picks a team if enabled or awaits trainer assignment.
- Completes the selected activity through a focused responsive experience.
- Sees one of three trainer-selected result policies: immediate own result; waiting/reveal; confirmation only.
- Must not see another person's responses/results without a deliberately authorized disclosure.

### C. Presenter (owner-controlled audience view)
- Displays clean visuals that remain legible on a projector.
- Can operate fullscreen from the same laptop or on a separate screen/window controlled by trainer.
- Shows only the current permitted presentation state, not private admin tools, submissions or raw answers.
- Has filters and toggles relevant to the tool; SCARF compares `Personal Pattern` and `Compared to Class` using the Integrated Needs Profile.
- Can hide/reveal results, identify/anonymize per consent, switch team, control comparison rules and return to a neutral waiting screen.

## Functional organization

```text
Tool Library
├── SCARF (first specialized tool)
├── Reflection / Learning Behavior (later)
└── Simple activity builder (later)

Execution context
├── Quick Activity (runs directly)
└── Class/Workshop = Session
    ├── Activity A
    └── Activity B
```

### Definitions
- **Tool**: reusable interactive feature/template with its own input, processing and presentation logic.
- **Session**: optional grouping for a class/workshop. Supports several activities and an optional common roster.
- **Activity**: concrete launched/configured instance of one tool. Has shareable access, owner controls, guests and results.
- **Guest participant**: one temporary activity/session identity with limited capability.
- **Team**: optional session/activity grouping, whose assignments can be changed by owner.
- **Submission**: versioned answer payload from a guest in an activity.
- **Result**: computed personal outcome and/or aggregate appropriate to one tool/version.
- **Presentation state**: current view, filters, privacy, reveal status and active output, controlled by trainer.

## SCARF class example (first acceptance scenario)
Trainer creates a SCARF activity for an in-person workshop of 24 people split into 4 teams. QR and PIN are shown on projector. Guests join on phones, provide names/team and answer. Trainer observes 18/24 complete, can close responses, and decides when to present. Trainer results can switch between each participant’s personal pattern and same-domain differences from the participant-weighted class mean. Presenter shows only privacy-protected team aggregates; individual names and scores remain trainer-only. This is a discussion aid, not a personnel evaluation.

## Initial MVP: must have
1. Single-owner login, dashboard, tool library and SCARF tool entry.
2. Quick Activity and optional Session containing activities.
3. QR/link/PIN join, temporary guest identity and optional teams.
4. Mobile assessment experience with draft/recovery/error states and submission.
5. Trainer progress count, activity open/close and result visibility policies.
6. SCARF scoring uses the supplied v0.2 candidate items and v1.1 scoring addendum, clearly disclosed as experimental and unvalidated.
7. Individual results + group summary + heatmap + personal/team-relative view.
8. Presenter on same screen and controllable separate screen (can implement the separate control via shared server state / polling in v1).
9. Basic activity history; clear deletion/privacy controls for personal data.

## Deliberately later
- Separate Reflection or Learning Behavior specialized tool.
- No-code builder for simple polls, rankings and reflections.
- Report export formats beyond the first practical need.
- Repeat assessments across sessions and longer-term trend analytics.
- Additional trainers, organizations, paid tiers, accounts for participants.

## Product quality principles
- A facilitator can start an activity in very few steps.
- Guests never need an account or installation.
- Screens prioritize clarity and tap targets over decorative UI during a test.
- Projector view readable at a distance, without leaking admin/individual private data.
- Every visible action does something; no cosmetic buttons.
- Saving and submitting must be idempotent, recoverable and clearly acknowledged.
