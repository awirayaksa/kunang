# kunang — brand guide

A Notepad-fast Markdown viewer and editor for Windows.

---

## The idea

**A firefly's flight path traces an `M`.**

The mark is one continuous stroke — the erratic up-down flight of a *kunang-kunang* — that
happens to land exactly on the letterform for Markdown. The stroke fades in from the dark,
gains light as it travels, and terminates in a glowing orb: the firefly itself, and the
cursor at the end of your document.

It carries the product thesis without a single word: **something small, fast, and luminous
that appears out of nowhere.** No gears, no pencils, no chevrons — nothing that says
"heavyweight IDE."

The wordmark is a custom monoline geometric lowercase. Circular bowls, a single stroke
weight, round terminals. Lowercase throughout — the app is quiet, not shouty.

---

## Palette

| Token | Hex | Use |
|---|---|---|
| `night-900` | `#070B16` | Deepest background, monochrome black |
| `night-800` | `#0E1426` | App chrome, wordmark on light |
| `tile-hi` | `#1B2542` | Icon tile gradient, top-left |
| `tile-lo` | `#080C18` | Icon tile gradient, bottom-right |
| `amber-500` | `#FFB020` | Trail origin, primary action |
| `amber-400` | `#FFC247` | **Core brand amber** |
| `amber-300` | `#FFD980` | Trail mid |
| `glow` | `#FFE9A8` | Trail terminus, focus rings |
| `core` | `#FFFBEC` | Orb highlight |
| `paper` | `#F6F4EF` | Light background, wordmark on dark |

The tile gradient runs `#1B2542 → #0F1729 → #080C18` on the top-left→bottom-right diagonal,
with a `rgba(255,255,255,0.09)` hairline inner border. That hairline is what keeps the icon
from looking flat against a dark taskbar — don't drop it.

Two colours only: **night** and **amber**. Never introduce a third brand hue. If the UI needs
semantic colour (diff green, error red), keep it desaturated so the amber stays the only
thing that glows.

---

## Lockups

| File | When |
|---|---|
| `kunang-mark.svg` | App icon, taskbar, installer, `.md` file association |
| `kunang-lockup-on-light.svg` | **Primary** horizontal lockup, light backgrounds |
| `kunang-lockup-on-dark.svg` | Primary horizontal lockup, dark backgrounds |
| `kunang-logo-horizontal-*.svg` | Lockup with the tiled icon — app stores, README headers |
| `kunang-logo-stacked-*.svg` | Splash, About dialog, square placements |
| `kunang-logo-mono-black/white.svg` | Single-colour: print, stamps, sponsor walls, engraving |
| `kunang-wordmark-*.svg` | Wordmark alone, when the mark already appears nearby |
| `kunang-glyph.svg` | Mark on transparent, no tile |
| `kunang-glyph-solid.svg` | Flat-gradient mark for rasterising below 32 px |

### Clear space
Minimum clear space on all sides = **the height of the letter `n`** in the wordmark
(≈ 40% of the mark's height). Nothing enters that zone.

### Minimum sizes
- Mark alone: **16 px** (ships in the `.ico`)
- Horizontal lockup: **96 px** wide
- Stacked lockup: **64 px** wide

Below 32 px, rasterise from `kunang-glyph-solid.svg` — the faded trail entry disappears at
those sizes and the `M` loses its left stem. The bundled PNGs already do this.

---

## Don't

- Don't recolour the trail. The gradient direction *is* the concept — light accumulating
  along a path.
- Don't outline, emboss, or drop-shadow the wordmark.
- Don't place the tiled icon on another coloured tile.
- Don't stretch, rotate, or re-space the lockup. Scale uniformly from the SVG.
- Don't set "kunang" in a system font as a substitute wordmark — use the vector files.
  For running text alongside the logo, a geometric sans (Poppins, Outfit, Plus Jakarta Sans)
  sits closest to the letterforms.
- Don't capitalise it. It's `kunang`, always lowercase.

---

## Windows integration

`icons/kunang.ico` is a multi-resolution icon containing 16, 24, 32, 48, 64, 128 and 256 px
layers — everything Explorer, the taskbar, Alt-Tab and the Start menu ask for. Small sizes
are supersampled 4× and Lanczos-downscaled, so they stay crisp rather than blurring.

**Rust / Tauri**

```toml
# tauri.conf.json → bundle.icon
["icons/kunang-32.png", "icons/kunang-128.png", "icons/kunang-256.png", "icons/kunang.ico"]
```

**C# / WinForms / WPF (.csproj)**

```xml
<PropertyGroup>
  <ApplicationIcon>assets\kunang.ico</ApplicationIcon>
</PropertyGroup>
```

**Electron Builder**

```yaml
win:
  icon: assets/kunang.ico
```

**File association** — register `kunang.ico` as the `DefaultIcon` for `.md` so a rendered
Markdown file is recognisable in Explorer before it's even opened:

```
HKCU\Software\Classes\kunang.md\DefaultIcon = "C:\Path\To\kunang.exe,0"
HKCU\Software\Classes\.md\OpenWithProgids\kunang.md
```

Ship the icon as resource index `0` in the executable so `,0` resolves.

---

## In-app

- Splash / empty state: the mark on `night-900`, wordmark below in `paper`.
- Preview pane: `paper` background, `night-800` body text.
- Editor pane: `night-900` background, `paper` text, **caret in `amber-400`** — the firefly
  lives in the cursor. It is the one moving amber element in the interface, and that
  restraint is what makes it feel expensive.
- Focus rings and the active-pane divider: `glow` at 40% opacity.

---

## Files

```
kunang-brand/
├── BRAND.md
├── kunang-mark.svg                    icon tile, 256
├── kunang-glyph.svg                   mark, transparent
├── kunang-glyph-solid.svg             mark, flat gradient (small sizes)
├── kunang-lockup-on-light.svg         primary horizontal
├── kunang-lockup-on-dark.svg
├── kunang-logo-horizontal-light.svg   tiled icon + wordmark
├── kunang-logo-horizontal-dark.svg
├── kunang-logo-stacked-light.svg
├── kunang-logo-stacked-dark.svg
├── kunang-logo-mono-black.svg
├── kunang-logo-mono-white.svg
├── kunang-wordmark-light.svg
├── kunang-wordmark-dark.svg
├── *@1024.png / *@800.png             raster lockups
└── icons/
    ├── kunang.ico                     16 / 24 / 32 / 48 / 64 / 128 / 256
    ├── kunang-{16..512}.png           tiled app icon
    └── kunang-glyph-{64..512}.png     transparent mark
```

Every SVG is hand-built geometry — no embedded fonts, no rasters, no filters. They render
identically in Explorer thumbnails, Chromium, resvg and Inkscape, and scale to any size
without touching the source.

*"…dark" / "…light" in a filename describes the **background it goes on**, not the ink.*

---

## The `.md` document icon (notepad style)

An original sheet drawn in the generic document idiom — rounded page, folded corner, ruled
lines — carrying an `MD` monogram. The `M` is the brand's firefly trail; the `D` is the same
monoline geometry as the wordmark, so the file icon and the app icon are visibly one family.
It is **not** a copy of Microsoft's Notepad artwork, which is trademarked and sits in a
different palette.

| File | Role |
|---|---|
| `kunang-md-notepad.svg` | Full detail — 48 px and up |
| `kunang-md-notepad-small.svg` | Rules dropped, monogram enlarged — 32 px |
| `kunang-md-notepad-tiny.svg` | Single `M`, no `D` — 16 and 24 px |
| `kunang-md-notepad-dark.svg` | Dark sheet, for dark file managers and in-app tab icons |
| `kunang-md-tile.svg` | The sheet on the brand tile — store listings, marketing |
| `icons/kunang-md-notepad.ico` | Multi-res, correct variant baked into each layer |

### Why three tiers
Detail that reads at 256 px turns to mud at 16 px. The `.ico` swaps artwork per layer:
ruled lines vanish below 48, and the `D` is dropped entirely at 24 and below because two
letters across ~11 usable pixels is an unreadable smear. One bold `M` on a page still says
"markdown file" at a glance in Explorer's list view.

### Detail worth preserving
The amber orb sits on the **top** of the `M`'s right stem, not at its foot. At the foot it
lands in the gap between the letters and reads as `M.D` — an abbreviation, not a monogram.
On the shoulder it reads as a firefly that landed on the page. Don't move it back down.

### Registering it

```
HKCU\Software\Classes\kunang.md\DefaultIcon = "C:\Path\To\kunang.exe,1"
```

Ship `kunang-md-notepad.ico` as resource index `1` and the app icon as index `0`, so the
document icon and the application icon stay distinct — the same split Windows uses for
Word and `.docx`.
