# SVG/DOM Renderer Migration Plan

## Overview
Replace the Pixi-based canvas renderer with an SVG/DOM rendering stack so text and geometry stay perfectly sharp at any zoom level.

## Milestones & Sub-Milestones

### Milestone 1 – SVG Stage Bootstrap
1.1 Create `SVGStage` component that mounts `<svg>` plus overlay `<div>` (no nodes yet).
1.2 Port viewport controller (panning/zoom matrix) to SVG transforms; hook to store updates.
1.3 Render placeholder grid/origin in SVG to verify transforms.

### Milestone 2 – Shape Rendering
2.1 Implement SVG rendering for rectangles/ellipses/polygons using existing scene data.
2.2 Add selection outlines and hit regions using SVG `<g>` layers.
2.3 Port marquee/group-selection visuals using SVG overlays.

### Milestone 3 – Interaction Layer
3.1 Recreate pointer hit testing using SVG element IDs/data attributes.
3.2 Reimplement drag/resize/rotate handles with absolutely positioned DOM elements or SVG shapes.
3.3 Hook toolbar/actions to the new renderer events (selection, marquee, context menus).

### Milestone 4 – Text Rendering
4.1 Render text nodes with `<text>` elements (font styles, alignment, baseline handling).
4.2 Implement underline/bold/italic/line-height directly via SVG attributes.
4.3 Ensure overlay handles interact correctly with text bounding boxes.

### Milestone 5 – Images & Tiles
5.1 Render basic images via `<image>` elements with scaling.
5.2 Rebuild tile LOD loader to insert/remove `<image>` tiles based on zoom.
5.3 Add clipping/masking support if required for image nodes.

### Milestone 6 – Cleanup & Parity
6.1 Remove Pixi-related code (StageCanvas, MSDF loaders, tilers) and unused deps.
6.2 Update tests/docs to describe the SVG renderer.
6.3 Profile large scenes; add batching or virtualization if necessary.
