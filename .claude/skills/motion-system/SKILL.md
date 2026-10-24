---
name: motion-system
description: How FlowForge moves. Read before adding or changing any animation, transition or landing-page effect in this repo.
---

# FlowForge motion system

Motion here has a job: show what the product does, or confirm what the user just did. Decoration that
moves on its own is the exception, and there is exactly one of it per page.

## The signature moment
The landing page is the brochure for an imaginary 1980s data terminal (src/Landing.tsx). Its CRT powers on, boots FLOWFORGE OS and draws the demo pipeline node by node with the real row counts of the bundled sample data, then idles with packets flowing along the edges. It plays once per visit; it does not loop.

Keep it a pure function of elapsed time (derive every state from `t`), pause it when off-screen
(IntersectionObserver), and show its most telling frame, static, under `prefers-reduced-motion`.

## Where motion lives
- Landing: the CRT (signature). Code tabs move only when clicked (sliding amber bar, short crossfade). Buttons press down onto their amber shadow.
- Workstation (#/app): node run states, row previews, panel toggles and the phosphor/scanline display settings. The workstation's look (phosphor green/amber/white on a black CRT, zero radius) is its identity; keep it.

## Tokens
Landing: --ff-paper, --ff-plastic, --ff-ink, --ff-amber, --ff-phosphor, --ff-screen in src/landing.css; Archivo (condensed, 72-80% width) for headlines, JetBrains Mono for anything the terminal prints. Workstation: .app tokens in src/styles.css.

## Rules
- Animate `transform` and `opacity` only (`clip-path` and SVG `stroke-dashoffset` are fine). Never `width`, `height`, `top`, `left` or `transition: all`.
- Curves: entering/exiting `cubic-bezier(0.23, 1, 0.32, 1)`; moving on screen `cubic-bezier(0.77, 0, 0.175, 1)`; colour/hover `ease`; constant motion `linear`. Never `ease-in` on UI.
- Durations: press 100-160 ms, popovers 150-250 ms, panels 200-400 ms. Explanatory landing motion may be longer.
- Enter from `scale(0.95-0.97)` + `opacity: 0`, never `scale(0)`. Exit the way you entered.
- Hover motion only inside `@media (hover: hover) and (pointer: fine)`. Buttons get press feedback (`scale(0.97)` on `:active`).
- No fade-and-slide-up on every section and no hover lift on every card: that is the generic look this project avoids.
- Anything a user can trigger repeatedly uses transitions (they retarget), not keyframes (they restart).
- Every animation ships with its `prefers-reduced-motion` variant: fewer and gentler, opacity instead of movement.
- Check the result in a browser: watch it at 2-5x slower, and on a phone width.
