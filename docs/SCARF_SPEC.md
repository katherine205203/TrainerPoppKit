# SCARF tool — functional specification and measurement boundaries

## Goal
A trainer-led activity to let individuals and teams explore their relative needs/preferences across the five SCARF dimensions, and discuss differences respectfully. It is not a hiring, performance ranking, clinical or validated diagnostic product by default.

## The five dimensions
1. **Status**
2. **Certainty**
3. **Autonomy**
4. **Relatedness**
5. **Fairness**

The earlier visual reference sometimes uses `Safety` incorrectly. Correct label is `Status`.

## Required participant flow
Join → identify/name → (optional select team) → instructions/disclosure → answer assessment → submit → visibility-policy outcome.

## Required trainer controls
- Configure and launch activity; teams optional and editable per user choice.
- View progress by participant/team and handle reopening/closure.
- Preview results privately before revealing anything to audience.
- Control result publication and display name/anonymous presentation subject to participant consent.
- Choose Team and choose the comparison basis in heatmap; display legend and sample size.

## Result views

### 1. Individual score/profile
Show five dimension values as calculated by the approved algorithm; do not infer that high means superior. Make it clear what scores measure and which item set/version was used.

### 2. Within-person pattern
For each person, compare the five dimensions **within the same person's response profile** (e.g., ranking/relative priorities based on approved scoring). A 4.2 that is low within one's profile can still be high relative to team members. Never label within-person ranking as a norm-referenced percentile.

### 3. Team-relative comparison
For each dimension, compare an individual with the **selected comparison population**, such as the same team. The population, exclusions, ties and threshold method must be explicit. This is descriptive comparison within this group, not a population norm.

### 4. Team heatmap
Rows: participants (or anonymous IDs) and optionally summary. Columns: five SCARF dimensions. User can toggle *Within-person* / *Relative to team*. Display color legend and accessible numeric text when allowed. Team filter; aggregate-only view when individual disclosure is inappropriate.

### 5. Group summary
Describe mean/median/distribution/spread where appropriate. Do not overinterpret percentile in very small groups. Do not silently assign low=negative or high=positive.

## P25/P75 example (not finalized)
User suggested color tiers based on lower 25%, middle 50%, upper 25%. This is an exploration requirement, not an approved algorithm. For small groups (e.g., 5–6 people), discrete percentile buckets are unstable; handle ties, labels, suppressed small-n views and sample-size warning. Do not force exactly 25% of members into each bin.

## Measurement/scoring is explicitly blocked pending approval
Do **not** generate plausible-looking SCARF items and present them as validated. Before implementing production assessment/scoring, obtain:
1. An approved question bank and proof of permitted use (existing instrument/license or independently authored items).
2. Language, dimensions assigned to items, scales/anchors and reverse-coded items if any.
3. Versioned dimension scoring rules, omissions/ties, rounding and valid submission criteria.
4. Rule for within-person comparison, group-relative percentile and interpretation copy.
5. Notice/consent text for named results and projector presentation.

UI mock data is acceptable for prototyping if unmistakably labelled **DEMO / MOCK** and excluded from production analytics.

## Data and interpretation safeguards
- Store `instrument_version`, `scoring_version`, activity id and timestamp with computed results.
- Avoid treating raw ranking/forced-choice and Likert scores as mathematically interchangeable.
- Hide named personal results unless permitted. Trainer access and projector access are separate scopes.
- Any group threshold policy must disclose minimum-n restrictions.
- Open question: clarify whether SCARF measures **personal drivers** or **current team experience**; these constructs should not share the same scoring/interpretation without justification. Initial concept prioritized personal drivers.

## Minimum test scenarios
- Five dimension scores correctly associated with labels and their approved items.
- A person's lowest internal dimension can be higher than the team mean and switches view correctly.
- Identical scores/ties handled explicitly; percentile display warns when n is insufficient.
- Moving a participant to another team recalculates group summaries without corrupting raw submission.
- With results hidden, guest/public presentation endpoints do not leak score payloads.
- Unconsented named profiles cannot appear on projector.
- Submission retry does not count twice; invalid/missing answers treated according to rule.
