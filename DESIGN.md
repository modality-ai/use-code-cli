# Design System — use-code-cli Web UI

Generated via `use-design tokens island --format json`. Source theme: `use-design/data/themes/island.yaml`. All color tokens include light/dark pairs unless noted.

## Typography

| Token | Value |
|---|---|
| `font.display` | "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif |
| `font.body` | "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif |
| `font.code` | "IBM Plex Mono", ui-monospace, SFMono-Regular, monospace |

## Radius

| Token | Value |
|---|---|
| `radius.sm` | 4px |
| `radius.md` | 12px |
| `radius.lg` | 16px |

## Elevation

| Token | Value | Tailwind utility |
|---|---|---|
| `shadow.pinned` | 0 10px 16px -6px rgb(0 0 0 / 0.35) | `shadow-md` (approximates the pinned shadow; arbitrary value removed) |

Use: the session transcript pinned context chip (`#context-bar`) and its
expand panel ("pinned message") both float over the scrolling transcript with
this shadow. Apply it to other floating overlays pinned over scrollable
content; combine with `bg-surface` + a `border`.

## Spacing

| Token | Value |
|---|---|
| `spacing.xs` | 4px |
| `spacing.sm` | 8px |
| `spacing.md` | 16px |
| `spacing.lg` | 24px |
| `spacing.xl` | 32px |
| `spacing.section` | 64px |
| `spacing.island-gap` | 24px |
| `spacing.plate-offset` | 8px |

## Colors

| Token | Light | Dark |
|---|---|---|
| `color.paper` | #fbf7ef | #1a1b1e |
| `color.surface` | #fffdf8 | #22252a |
| `color.border` | #d8d4cb | #3a3e44 |
| `color.text.primary` | #23262b | #e8e6e1 |
| `color.text.muted` | #5b5f66 | #a6a9ae |
| `color.accent.collaboration` | #1f6f78 | #4dacb2 |
| `color.glow.night` | #f2c879 | — |
| `color.island.civil` | #9ebcd1 | #386889 |
| `color.island.institute` | #d4c2e0 | #844ba9 |
| `color.island.transport` | #d4a591 | #8a492e |
| `color.island.education` | #9fd0b8 | #3a8861 |
| `color.island.lunch` | #cdb284 | #795c2a |
| `color.island.family` | #ddbbc9 | #a4476d |
| `color.island.card` | #a978ba | #552c63 |
| `color.island.welfare` | #b4dad9 | #439d9b |
| `color.island.sport` | #ead1cd | #bd5b4c |
| `color.island.trails` | #afcb90 | #597b32 |
| `color.island.forest` | #59b164 | #296531 |
| `color.island.youth` | #a6acd3 | #3d488e |
| `color.island.diplomacy` | #ce97c3 | #823573 |
| `color.island.hakka` | #dfdeb9 | #a8a642 |

## Full Token JSON

```json
{
  "theme": "Island",
  "version": "alpha",
  "tokens": [
    { "path": "color.paper", "type": "color", "value": "#fbf7ef", "dark": "#1a1b1e" },
    { "path": "color.surface", "type": "color", "value": "#fffdf8", "dark": "#22252a" },
    { "path": "color.border", "type": "color", "value": "#d8d4cb", "dark": "#3a3e44" },
    { "path": "color.text.primary", "type": "color", "value": "#23262b", "dark": "#e8e6e1" },
    { "path": "color.text.muted", "type": "color", "value": "#5b5f66", "dark": "#a6a9ae" },
    { "path": "color.accent.collaboration", "type": "color", "value": "#1f6f78", "dark": "#4dacb2" },
    { "path": "color.glow.night", "type": "color", "value": "#f2c879" },
    { "path": "color.island.civil", "type": "color", "value": "#9ebcd1", "dark": "#386889" },
    { "path": "color.island.institute", "type": "color", "value": "#d4c2e0", "dark": "#844ba9" },
    { "path": "color.island.transport", "type": "color", "value": "#d4a591", "dark": "#8a492e" },
    { "path": "color.island.education", "type": "color", "value": "#9fd0b8", "dark": "#3a8861" },
    { "path": "color.island.lunch", "type": "color", "value": "#cdb284", "dark": "#795c2a" },
    { "path": "color.island.family", "type": "color", "value": "#ddbbc9", "dark": "#a4476d" },
    { "path": "color.island.card", "type": "color", "value": "#a978ba", "dark": "#552c63" },
    { "path": "color.island.welfare", "type": "color", "value": "#b4dad9", "dark": "#439d9b" },
    { "path": "color.island.sport", "type": "color", "value": "#ead1cd", "dark": "#bd5b4c" },
    { "path": "color.island.trails", "type": "color", "value": "#afcb90", "dark": "#597b32" },
    { "path": "color.island.forest", "type": "color", "value": "#59b164", "dark": "#296531" },
    { "path": "color.island.youth", "type": "color", "value": "#a6acd3", "dark": "#3d488e" },
    { "path": "color.island.diplomacy", "type": "color", "value": "#ce97c3", "dark": "#823573" },
    { "path": "color.island.hakka", "type": "color", "value": "#dfdeb9", "dark": "#a8a642" },
    { "path": "font.display", "type": "typography", "value": { "fontFamily": "\"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif" } },
    { "path": "font.body", "type": "typography", "value": { "fontFamily": "\"Noto Sans TC\", \"PingFang TC\", \"Microsoft JhengHei\", sans-serif" } },
    { "path": "font.code", "type": "typography", "value": { "fontFamily": "\"IBM Plex Mono\", ui-monospace, SFMono-Regular, monospace" } },
    { "path": "radius.sm", "type": "dimension", "value": "4px" },
    { "path": "radius.md", "type": "dimension", "value": "12px" },
    { "path": "radius.lg", "type": "dimension", "value": "16px" },
    { "path": "spacing.xs", "type": "dimension", "value": "4px" },
    { "path": "spacing.sm", "type": "dimension", "value": "8px" },
    { "path": "spacing.md", "type": "dimension", "value": "16px" },
    { "path": "spacing.lg", "type": "dimension", "value": "24px" },
    { "path": "spacing.xl", "type": "dimension", "value": "32px" },
    { "path": "spacing.section", "type": "dimension", "value": "64px" },
    { "path": "spacing.island-gap", "type": "dimension", "value": "24px" },
    { "path": "spacing.plate-offset", "type": "dimension", "value": "8px" }
  ]
}
```

## Usage

Regenerate with:

```bash
use-design tokens island --format json --out DESIGN.md  # or adjust to markdown via script
```

Or re-export tokens:

```bash
use-design tokens island --format json
```
