---
version: 1
slug: "src-themes-editorial"
primary_target: "src/themes/editorial"
related_targets: ["src/pages"]
---

# Surface brief: Journal theme (all public pages)

Scope: the merged public theme (`theme: journal`, code id `editorial`) across home, research, publications, CV, blog, people, news, talks, positions, projects, repositories, contact, 404. Visitor modes: home = Experience/Persuade-light (who is this, what do they work on); content pages = Read. Audience: prospective students, collaborators, committees, reviewers (PRODUCT.md). Constraints: personal + lab, light + dark, LTR + RTL, configurable accent/fonts/hero, WCAG AA, Lighthouse 95+.

Direction: user-pinned in DESIGN.md ("The Quiet Journal": editorial base + classic's dark mode, configurable accent/fonts, hero/section options, lab-mode pages). No concept roll: the user pinned the world. Build path: code-led.

## Direction contract
THESIS: A researcher's site typeset like a well-edited journal page; it refuses the card-grid portfolio and the al-folio sidebar template.
OWN-WORLD: White paper, ink #15192b text ladder and one owner-selectable accent (navy); in dark, one of three owner-selectable night palettes (editorial.night: Lamplight #1a1713 / ivory #ede7dc / night blue #9cb1dd by default, Ink Well, Galley Proof), 1px hairline rules instead of boxes, Source Serif 4 for names/titles/reading, IBM Plex Sans for UI, tabular numerals, venue tiles, ink line-art plates that invert in dark.
STORY: The visitor learns who the person or lab is, what they study, sees real papers with citations, and finds how to work with them, in that order.
FIRST VIEWPORT: Home: name at display size (62px serif) left, italic tagline, bio, primary "View publications" + CV link; a Tint-framed ink figure with "Fig. 1" caption right; hero.type backdrop (hairline pattern at 7%) behind; nav with mode toggle on top.
FORM: Journal page (pinned by user; DESIGN.md is the form); seed key: none (pinned direction, no roll).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
