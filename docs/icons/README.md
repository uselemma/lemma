# Docs icons

Two folders, two jobs:

## `/icons/` — Remix glyphs

These SVGs are [Remix Icon](https://remixicon.com/) line glyphs (same set as `@remixicon/react` on the platform). Use them for nav groups, tabs, and other chrome.

Mintlify only supports Font Awesome, Lucide, and Tabler as built-in libraries, so glyphs are vendored here and referenced as `/icons/<name>.svg` from `docs.json` and MDX.

`docs/style.css` forces these images to black in light mode and white in dark mode (`img[src*="/icons/"]`). Keep fills as `currentColor`; do not bake in a brand color.

When adding or replacing a glyph, copy the matching Remix line icon so docs stay visually aligned with the platform.

The Claude Code contextual-menu mark lives here (`/icons/claude.svg`) so it gets the same monochrome filter.

## `/images/brands/` — third-party marks

Integration and product logos. Paths must **not** contain `/icons/`, or the Remix filter will flatten them.

Pick one theme strategy per file and stick to it:

1. **Fixed brand color** — hex `fill` on the path (LangChain, LangGraph, OpenAI Agents).
2. **Theme-flipping monochrome** — embedded `<style>` with `@media (prefers-color-scheme)` (Vercel, Mastra). Do not also set `fill="currentColor"` on the path.

Reference them as `/images/brands/<name>.svg` from page `icon` frontmatter.
