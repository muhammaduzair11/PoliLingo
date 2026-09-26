# PoliLingo Design System

The shipped visual language of PoliLingo: a warm, storybook-meets-product
system built around a mascot companion, poster-scale typography and
course-tinted surfaces. This document describes what is actually implemented
in `app/globals.css`, `app/layout.tsx`, the `components/` modules and
`lib/courses.ts`. Treat it as the source of truth for visual decisions; when
this document and the code disagree, fix the document.

## 1. Design intent

PoliLingo teaches Pashto, Hindko and Urdu in small, playful lessons. The
design goals, in order:

1. **Warm, not childish.** Playfulness comes from shape, motion and mascot
   acting — not from candy palettes or cartoon fonts. Surfaces read as paper
   and sticker, never as plastic toy.
2. **Companion-led.** Poli the markhor is a character with poses and intent,
   not decoration. Every screen has a reason for the mascot's expression.
3. **Poster clarity.** One idea per viewport, huge display type, generous
   whitespace, then a dense playful detail layer (stars, orbits, marquee)
   underneath.
4. **Respectful of the learner.** Real text, real language attributes,
   user-controllable motion and sound, and no dark patterns in gamification.

Voice and microcopy follow the same rules: short, warm, second-person,
never preachy. Examples in product: "A little daily. A lot more connection.",
"Find your words. Find your people.", "I saved you a spot."

## 2. Colour

All tokens live in `:root` in `app/styles/tokens.css` and are mapped into Tailwind
theme variables in the `@theme` block of the same file, which `app/globals.css`
imports first.

| Token | Value | Role |
| --- | --- | --- |
| `--background` | `#fffcf7` | Warm ivory paper; the default canvas |
| `--foreground` / `--ink` | `#26183b` | Deep aubergine ink; all body and display text on light |
| `--primary` | `#6935ce` | Brand violet; hero field, header CTA, footer band |
| `--purple` | `#6230bd` | Deeper violet for accents on light |
| `--ring` | `#8853e9` | Focus rings |
| `--yellow` | `#ffda57` | Accent on violet only (hero keyword, primary CTA on purple) |
| `--pink` | `#ff9fba` | Marquee band, playful dividers |
| `--mint` | `#c4efcd` | Success-adjacent tint, decorative stars |
| `--muted` / `--muted-foreground` | `#eee8f4` / `#6b6277` | Quiet surfaces and secondary text |
| `--border` / `--input` | `#ded6e7` / `#ddd4e9` | Hairlines and field outlines |
| `--accent` / `--secondary` | `#eee6ff` (fg `#311264`) | Lilac chips and secondary buttons |
| `--color-destructive` | `#b63751` | Destructive actions |
| `--radius` / `--radius-lg` / `--radius-xl` | `1rem` / `1rem` / `1.5rem` | Shape language |

### Course identities

Each language owns a tint, declared as `color` in `lib/courses.ts` and applied
through the `--course-color` custom property on that course's surfaces
(language card, onboarding art panel, learn-page map banner).

| Course | Tint | Character |
| --- | --- | --- |
| Pashto | `#c4e5ff` | Sky blue; mountains and open horizons |
| Hindko | `#d3f4d8` | Mint green; valleys and orchards |
| Urdu | `#ffd3df` | Blossom pink; courtyards and lanterns |

### Usage rules

- Violet is a **field**, not an accent: it fills the hero, the header CTA and
  the closing band. Yellow sits on violet and nowhere else.
- Course tints only ever appear as **backgrounds** for that course's own
  surfaces; text on them stays `--ink`.
- Ivory is the default canvas. Do not invert the app to a dark canvas; the
  system's warmth depends on paper-light surfaces with saturated colour
  blocks on top.
- Shadows are soft and violet-tinted (e.g. `#35176040`), never neutral black.

## 3. Typography

Loaded in `app/layout.tsx` from Google Fonts with `preconnect`, with local
fallbacks:

- **Outfit** (400–900) — UI and display. Assigned to `--font-sans` and
  `--font-heading`.
- **Noto Naskh Arabic** (400/600/700) — every native-script run, via the
  `.native` class: `font-weight: 600`, `line-height: 1.8`,
  `letter-spacing: 0`.

### Scale

| Level | Treatment |
| --- | --- |
| Display / hero | `.hero h1`: `clamp(64px, 6.7vw, 94px)`, weight 700, `letter-spacing: -0.065em`, `line-height: 1.015` |
| Section headings | 44–65px across breakpoints, weight 700, tight tracking |
| Eyebrow / kicker | `.eyebrow`: 12px, weight 700, `letter-spacing: 0.16em`, uppercase |
| Body | 17px Outfit 400/500 |
| Native script | `.native`, sized per context (25px on cards up to ~46px in hero panels) |

Display type is deliberately poster-like: oversized, tightly tracked, and
broken across lines for rhythm ("A little daily. / A lot more /
connection."). The hero keyword carries a hand-drawn underline flourish
(`.connection svg`, `#ffcb49`, 5px round-cap stroke) rather than a colour
change alone.

### Script handling

Native-script runs are always rendered through the `Native` component in
`components/native.tsx`, which sets `lang` and `dir="rtl"` on the element.
Never paste Arabic-script text into a Latin-text node; screen readers and
shaping both depend on the attributes.

## 4. Layout and shape language

- **Radii:** 1rem for cards and controls, 1.5rem for large panels. Corners are
  consistently round; there are no sharp-edged containers.
- **Sticker cards:** white or tinted panels with soft violet shadows and
  slight rotations on decorative children, so the page reads as stuck-down
  paper.
- **Language cards:** three-up grid on desktop. Each has a numbered kicker
  (`01 / EXPLORE`), the native endonym, then a `.world-frame` window 215px
  tall in which the world render bleeds to the edges. Hover lifts the render
  and rotates it 3deg.
- **Marquee band:** `.marquee` is a pink kinetic divider, `animation: marquee
  38s linear infinite`, repeating "FIND YOUR WORDS ✳ FIND YOUR PEOPLE ✳ …".
  It is `aria-hidden`.
- **Learning map:** the learn page lays lesson nodes along a dashed SVG path
  (`.path-line`); locked nodes are muted pills with a lock glyph, completed
  nodes carry the course colour.
- **Hero composition:** split copy/art. Behind Poli sit `.hero-halo` (a solid
  yellow disc) and `.hero-orbit` rings; decorative stars float at the edges.
- **Sticker pods:** `.poli-sticker` is an ivory rounded pod that hosts a
  mascot render with a `.poli-caption` label; used wherever Poli "speaks".

## 5. Mascot and art direction

Poli is a cream markhor with violet spiral horns and an orange satchel. The
renders are soft-clay 3D dioramas: saturated but never neon, with rounded
geometry and visible material texture. World art is a floating island
diorama per language (mountain gate for Pashto, valley house for Hindko,
courtyard for Urdu).

Masters live in `assets-src/` (see `docs/architecture.md` for the pipeline).
Poses and their semantic use:

| Pose | Used for |
| --- | --- |
| `welcome` | Hero, map idle, default greeting |
| `thinking` | Study intro, resume card |
| `celebrate` | Lesson and course completion |
| `encourage` | Empty states, continue prompts |
| `rest` | Settings, breaks, streak pauses |

Rules:

- Pose must match the learner's situation; do not celebrate an unfinished
  lesson.
- The hero/welcome pose carries descriptive alt text; repeated decorative
  appearances use empty alt.
- Poli always appears at a size the source ladder can serve crisply — see the
  `sizes` guidance in `docs/architecture.md`.

## 6. Motion

Keyframes in `app/styles/keyframes.css`: `float` (translate −14px with a −2deg→1deg
rotate), `wiggle` (±15deg rotate), `marquee` (translateX −50%).

- Hero Poli floats; decorative stars wiggle on long periods (5–7s).
- Cards and buttons lift on hover; the hero art applies a pointer parallax
  tilt via the `--tilt` custom property, **mouse pointers only** and only
  when motion is enabled.
- The marquee is the only perpetual horizontal motion.

### Reduced motion (two independent switches)

1. OS preference: `@media (prefers-reduced-motion: reduce)` disables all
   animation and transition and resets the hero transform.
2. In-app preference: `learning-provider.tsx` sets
   `html[data-motion="reduced"]` from `prefs.reducedMotion`, with an identical
   kill-switch rule set. Exposed as the header `MotionButton` (pause/play) and
   a Settings switch.

Both must keep working; any new animation is required to die under both.

### Sound

Optional feedback sounds use the Web Audio API and are only created after an
explicit user gesture, gated by a settings/header toggle. Nothing autoplay.

## 7. Accessibility

- Skip link to `#main-content` is the first element in `body`.
- All copy is real HTML text; no text in images.
- Decorative layers (`marquee`, orbit rings, sparks, deco stars) are
  `aria-hidden`.
- Focus visibility uses `--ring`; interactive elements are real buttons and
  links, never styled divs.
- Colour pairs are chosen for contrast on their surfaces: ink on ivory,
  white on `--primary`, ink on course tints.
- Motion and sound are user-controllable and default to the OS preference.

## 8. Responsive strategy

Type is fluid via `clamp()`; layout refinements land in media queries at
1500px, 1100px, 800px, 580px and 350px. The first four each have a file in
`app/styles/` (`responsive-*.css`). **Check `refinements.css` before editing one of
them:** it is imported last and holds the only 350px block, a second 800px and
580px block, and a 581–1100px tablet range, all of which win over the matching
`responsive-*.css` rules.

- Language cards collapse 3 → 1 column; the world frame keeps its bleed.
- The hero stacks copy above art; display type scales down but never below
  ~40px.
- The learning map narrows to a single column path; the marquee persists at
  all widths.
- Touch targets and card padding grow, not shrink, on narrow viewports.

## 9. Guardrails

Do not:

- Introduce a dark/neon canvas or a candy-pastel palette; the shipped system
  is ivory paper + aubergine ink + violet fields with course tints.
- Use cartoon or rounded-novelty display faces; Outfit carries the voice.
- Add animation without a reduced-motion escape hatch.
- Render native script without `lang`/`dir`.
- Ship raw PNGs or let any optimizer re-encode the art ladder (see
  `docs/architecture.md`); both have previously caused quality regressions.
- Give differently-sized art slots a shared `sizes` value; it upscales the
  large slots and reads as blur.
