# Design System — implementation contract

**Brand:** Popp! · **Product:** TrainerPopp!Kit
**Source:** supplied six-page visual `assets/TrainerPoppKit_StyleGuide_Reference.pdf`. The PDF is a **visual-direction reference**, not pixel-perfect engineering specifications or a licensed source for official SCARF questions.

## Visual principles
- **Playful, modern, human**. Looks art-directed and specific rather than a generic enterprise/AI dashboard.
- **Flat first:** vivid solid fills, crisp silhouettes, warm off-white space, big typography, high layout clarity.
- **Organic geometric shapes:** flower/blob, sparkle/diamond, bean, circle, semicircle/arch, speech bubble, rounded card and pill.
- **Mascot faces are decorative**, with minimal eyes/mouth. Avoid glossy 3D, photorealism, needless gradients, complex outlines or cartoon overload.
- Data/assessment UI is **precise**; reserve playful illustrations for Home/Tool cards/Join/Success and limited decoration around results.

## Color tokens (explicitly defined from approved palette board)

| Token | Name | Hex | Intended use |
|---|---|---|---|
| `brand-electric` | Electric | `#3939FF` | Main action, active controls, key emphasis |
| `brand-orange` | Dare Devil | `#FF5B22` | Action accent, energetic illustrations |
| `brand-arctic` | Arctic | `#AEE6ED` | Supportive pale surface / illustration |
| `brand-royal` | Royal | `#DBB8FF` | Supporting visual / secondary emphasis |
| `brand-gold` | Gold | `#F2BB05` | Highlight and celebratory detail |
| `brand-pink` | Pink | `#FF6BCB` | Secondary playful accent |
| `surface-canvas` | Canvas | `#FAF6EF` | Primary warm page background |
| `text-ink` | Ink | `#1F1F1F` | Body/heading text |
| `surface-mist` | Mist | `#E6E6EA` | Subtle dividers / neutral surfaces |

**Implementation note:** These are expressive brand swatches, *not* a valid categorical-to-score mapping for SCARF. Choose dedicated chart-scale and contrast tokens based on data semantics and test accessibility. Pure vivid colors may need darker/lighter variants for text buttons, disabled states and WCAG compliance.

### Suggested initial CSS tokens (not yet signed off)

```css
:root {
  --brand-electric: #3939FF;
  --brand-orange: #FF5B22;
  --brand-arctic: #AEE6ED;
  --brand-royal: #DBB8FF;
  --brand-gold: #F2BB05;
  --brand-pink: #FF6BCB;
  --surface-canvas: #FAF6EF;
  --surface-card: #FFFFFF;
  --surface-mist: #E6E6EA;
  --text-ink: #1F1F1F;
  --radius-control: 12px;
  --radius-card: 18px;
  --radius-pill: 9999px;
  --space-unit: 4px;
}
```

Numbers for radii/spacing are **proposals** to validate against implemented UI, not measurements extracted from raster PDF.

## Typography
- Primary: **Plus Jakarta Sans**, with system fallback (`ui-sans-serif, system-ui, sans-serif`).
- Hierarchy: display/header bold 700–800; section title semibold 600–700; body regular 400; caption medium 500.
- Suggested desktop sizes (confirm during Phase 1): Display 42–56; H1 32; H2 24; H3 18–20; body 14–16; caption 12–13 px. Mobile H1 about 26–30 px.
- Readability beats cute lettering in data labels, forms and long Vietnamese text.
- Handwritten doodle-style slogans appear only in occasional visual/marketing illustrations; do not use as the UI body font.

## Shape and icon language
- Small rounded geometric motifs that can form friendly characters.
- Navigation icons should be simple, recognizable and consistent in stroke and size; use a single icon family for functional controls.
- Decorative shape-icons differ from navigational/action icons; no ambiguous decorative element should look clickable.
- Brand logo currently represented by four colored rounded petals/dots and a stacked product wordmark in the PDF; **rename to TrainerPopp!Kit** before production branding.
- Do not treat AI-rendered characters as editable SVG assets. For production, recreate approved shapes as code/SVG assets with known ownership and consistent geometry.

## Core component families
1. Primary/secondary/ghost/destructive buttons and icon button.
2. Text, search, PIN entry and select input.
3. Checkboxes, radios, switches and segmented controls.
4. Status badges and toast/inline feedback (live/draft/completed/error).
5. Sidebar, breadcrumb, tabs, pagination/progress.
6. Tool card, activity card, session card, participant row, statistic card.
7. Charts: bar/column, distribution, radar where appropriate, progress and heatmap cell+legend.
8. Presenter controls: mode toggle, group selector, compare basis, privacy display option, reveal/hide/fullscreen.

## Layout guidance
- Desktop: content-focused sidebar and comfortable central working area; use 12-column grid concepts where helpful.
- Guest mobile: vertically ordered actions, progress always clear; one primary CTA per page.
- Presenter: eliminate admin navigation from audience output; prioritize visual scale, headings and legend.
- Spacing: start with 4px base increments and check hierarchy; use consistent 16–24 px card padding on desktop and responsive mobile reductions.
- Use generous whitespace and **minimal or no shadows**. Avoid large decorative shapes that compromise controls/legends.

## SCARF visualizations — mandatory correctness
- Dimension names are **Status, Certainty, Autonomy, Relatedness, Fairness**. The PDF's illustrative 'Safety' label is incorrect for SCARF and must not be copied.
- Scores and profiles in the PDF are sample visuals; do not replicate them as actual workshop facts.
- Colors must have defined data meaning, and may not imply low = bad/high = good.
- Every heatmap needs an explicit comparison basis, reference group, algorithm/version and legend. Show limitations when group size is small.
- Sorting and anonymization should not be silently conflated with scoring.

## Reference pages
1. Cover and design system sections.
2. Core palette, typography, examples.
3. Core shapes, characters, iconography, illustration do/don't.
4. Buttons, forms, selection, badges, navigation, content cards.
5. Trainer dashboard, activity setup, mobile guest journey, responsive layout.
6. Data visualization and presenter mockup.

## Definition of design implementation complete
- Tokens and actual components defined in source, not merely screenshot backgrounds.
- Trainer dashboard, guest mobile and presenter share a coherent visual grammar while serving different use needs.
- Buttons/toggles have wired behavior, keyboard/focus states and tested accessible contrast.
- Screenshot review at desktop, tablet and mobile widths; verify direct comparison with approved PDF reference.
