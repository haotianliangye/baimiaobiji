# Adversarial Review Challenge Report

## Challenge Summary

**Overall risk assessment**: CRITICAL (due to the missing input form blocker)

## Challenges

### [Critical] Challenge 1: Missing Input Form in Empty State

- **Assumption challenged**: The input form is always accessible at the bottom of the page.
- **Attack scenario**: The user enters the app for the first time or starts a new day, resulting in 0 raw logs. The app renders ONLY the empty state placeholder container, completely omitting the form structure.
- **Blast radius**: Complete loss of core app functionality (cannot add new logs).
- **Mitigation**: Move the form outside of the conditional `{!logs || logs.length === 0 ? ...}` block, rendering it consistently at the bottom of the `flex-col` container.

### [Medium] Challenge 2: Compositor Layers Repaint Overhead & Text Blurriness

- **Assumption challenged**: Using `will-change: transform` and `transform: translate3d(0,0,0)` guarantees smooth transitions.
- **Attack scenario**: On hover, the box-shadow and border-color are animated. Because the element is a compositor layer, any paint updates on it force the browser to re-rasterize and re-upload the layer's texture to the GPU on every frame, leading to CPU/GPU pipeline overhead. Additionally, text inside a composited layer will lose subpixel anti-aliasing and become permanently grayscale anti-aliased. Specifying `-webkit-font-smoothing: subpixel-antialiased !important` on a GPU layer conflicts with the rendering engine.
- **Blast radius**: Stutter/jank during animations on lower-end devices, text blurriness.
- **Mitigation**:
  1. Remove `box-shadow` from `will-change`.
  2. Implement box-shadow transitions using a pseudo-element (`::after`) with the hover shadow and transition its opacity, which runs purely on the GPU compositor without triggering repaints.
  3. Remove `-webkit-font-smoothing: subpixel-antialiased !important` from composited cards to prevent browser layout conflicts.

### [Low] Challenge 3: WebView Scroll Leaks & Mismatch Visuals

- **Assumption challenged**: `overflow: hidden; overscroll-behavior: none` completely locks the WebView layout scrolling.
- **Attack scenario**:
  1. On iOS Safari WebViews, reaching a scrollable container's limits can trigger scroll chaining, causing the entire body to bounce.
  2. Modal overlays (edit modal, about modal, calendar heatmap) do not intercept/prevent `touchmove` events, causing the background to scroll when dragging modal backdrops.
  3. WebView overscroll bounce exposes a white background (`#ffffff !important` on body) which conflicts with the outer page canvas background `#f0eef5`.
  4. Missing `viewport-fit=cover` breaks bottom safe area layouts on notched iPhones.
- **Blast radius**: Bouncing gaps, non-native layout experience, visual glitches.
- **Mitigation**:
  1. Add `viewport-fit=cover` to the viewport meta tag.
  2. Align the `html, body` background color with the layout canvas color (`#f0eef5`).
  3. Prevent touchmove on overlays/modals using `e.preventDefault()` on touch move handlers.

## Stress Test Results

- Clean database load → empty logs array → Branch 1 evaluated → input form is missing → [FAIL]
- Paint flashing on hover → box-shadow & border-color transition → paint flashes green on card → [FAIL]
