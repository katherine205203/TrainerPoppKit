# SCARF Assessment — implementation contract

**Current source:** `TrainerPoppKit_SCARF_Product_Pack_v1.2.zip`, including the Product Specification, immutable English Question Bank v0.2, Scoring Specification v1.1, Codex Handoff, eight participant mobile references, trainer and presenter references, and app branding references. The scoring addendum replaces only the results, scoring, and heatmap portions of the earlier product spec; its other locked product decisions remain in force.

**Instrument status:** experimental and not psychometrically validated. These 30 candidate items are not represented as an official NeuroLeadership Institute questionnaire. The app must not make clinical, diagnostic, trait, competence, or population-norm claims.

## Locked module decisions

1. This module is SCARF Assessment, personal results, trainer analytics/heatmaps, and presenter mode. It does not add separate check-in or reflection activities.
2. Activities may be standalone or attached to an existing session.
3. At activity creation the trainer chooses `immediate` or `trainer_released`. The choice freezes at first open/join; an existing release is not silently revoked.
4. The owner may view named individual results. Presenter capabilities are aggregate-only and never receive participant records or identifiers.
5. Analytics support activity, session, and team scopes. Session reports select the latest compatible response per session identity and disclose incompatible-version exclusions.
6. Each participant has one current submission per activity and cannot self-retake. An owner reset clears current answers/results, increments the generation, and writes an audit event.
7. Keep the 30 questions and all three response sections unchanged. Continue storing **Reaction Intensity** and **Driver Priority**. Add the **Integrated SCARF Needs Profile** as a separate derived view and use it for current heatmaps.
8. Heatmap modes are **Personal Pattern** and **Compared to Class**. Team means are participant-weighted; the comparison reference is the same-domain class mean.

## Participant flow and privacy

- Reuse existing no-account QR/link/PIN join, participant identity, team, and scoped temporary guest token.
- Welcome → Q01–Q10 reactions → transition → Q11–Q20 trade-offs → transition → Q21–Q30 three-way rankings → submission → personal results or release-waiting state.
- Question APIs return permitted text and response choices only. Domain mappings and score keys stay server-side.
- Autosave each complete answer, keep the current question/view for resume, allow back/edit before submission, and make submitted attempts read-only until an owner reset.
- A paused or closed activity rejects answer changes and submission. Participant results are available only through that participant’s token and the selected release policy. Raw answers are not returned by participant or presenter APIs.

## Versioned scoring

The immutable v0.2 question bank contains 30 English items in original order. New activities pin instrument `0.2.0` and scoring `1.1.0`. The server validates and recalculates every result from persisted answers.

- **Reaction Intensity (R):** Q01–Q10 use integer 1–10 item-specific anchors. Each domain’s score is the mean of its two mapped reactions.
- **Trade-off preference (B):** Q11–Q20 allocate A/B points using `(1,0)`, `(.75,.25)`, `(.5,.5)`, `(.25,.75)`, or `(0,1)` for `strong_A`, `lean_A`, `equal`, `lean_B`, or `strong_B`. Each domain appears four times; divide allocated points by four.
- **Three-way ranking (T):** Q21–Q30 require a complete A/B/C permutation. Award `(1,.5,0)` for first/second/third rank. Each domain appears six times; divide points by six.
- **Driver Priority (P):** `1 + 9 × (0.5 × B + 0.5 × T)`. Each domain is 1–10 and the five priorities sum to 27.5 by construction. R and P remain separate measures.
- **Integrated Needs Profile:** within each section separately (R, B, T), rank the five domain scores descending using midranks; values within `1e-9` are ties. Convert each rank to `H = (5 - rank) / 4`, then calculate `NeedsIndex = 1 + 9 × mean(H_R, H_B, H_T)`. Rank the five final NeedsIndex values with the same descending midrank rule. Higher index means more favored relative to the person’s other domains in this activity; it is not an absolute need level.

Persist R, B, T, P, Integrated Needs Index/rank, instrument/scoring versions, generation, and reproducibility metadata. Migration `0010_scarf_scoring_v11.sql` adds nullable v1.1 fields; historical v0.2 results remain intact and are not silently rescored or relabeled.

## Results and analytics

- Participant results lead with the Integrated Needs Profile and personal pattern/detail views; Reaction Intensity and Driver Priority remain available separately as additional measures.
- Trainer results include named progress/submission rows, personal pattern ranks, same-domain class deltas on a fixed ±3 display scale, team-by-domain means and deltas, release/reset controls, compatible session analytics, and safe CSV export. Trainer-only named records remain behind owner authentication.
- Team means first average participant-level NeedsIndex values. The class mean weights each participant equally, not each team equally. Team ranking is then computed from the five team means.
- Historical results without v1.1 fields do not receive an Integrated Needs Profile. The UI identifies the older scoring version and preserves its R/P measures.
- Presenter receives only server-computed aggregate NeedsIndex values. Require five distinct compatible, released submissions for any displayed aggregate. If any team is below five, suppress the entire team breakdown and complementary values while retaining the overall aggregate only when its cohort is at least five. Suppress both values and visual encodings when unsafe.
- Session analytics use the latest compatible submission per session identity. Presenter data contains no names, IDs, answer records, roles, or consent fields.

## Visual implementation

Follow the supplied P01–P08 mobile mockups and desktop trainer/presenter references while reusing the existing TrainerPopp!Kit shell and electric blue, warm white, orange, yellow, pink, aqua, lavender, and mascot identity. Use responsive, data-backed controls rather than static screenshots. Numerical pixel-diff similarity has not been measured.

## Verification and remaining work

- Unit tests compare the TypeScript scorer against all 20 supplied synthetic v1.1 vectors, including class means, same-domain deltas, team weighting, ties, flat profiles, validation, and fixed-sum properties.
- Worker/D1 smoke tests cover activity version pinning, all 30 answers, autosave and submission, result release, named trainer analytics, preserved R/P and integrated fields, presenter identity isolation, minimum-n/complementary suppression, session deduplication, CSV, reset, and stale generations.
- Run `npm test`, `npm run smoke`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run db:migrate` for local checks.
- Psychometric validation, legal/usage review, Vietnamese localization, production secrets, remote D1, and Cloudflare deployment remain separate work. Do not describe the instrument as validated until independent validation is completed.
