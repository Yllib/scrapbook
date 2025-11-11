# Vector Glyph Rendering Migration Plan

## 1. Preprocess Fonts Ahead of Time
- Select the supported font family/weight/style combinations.
- Use a build script (e.g. with `opentype.js`) to load each TTF/OTF and iterate the glyphs you want (ASCII + extended set).
- For every glyph:
  - Extract its outline commands.
  - Tessellate curves into triangles at a controllable quality level.
  - Record glyph metrics (advance, bearings, bounding box) and kerning pairs.
- Bundle per-style geometry/metric data into JSON or a compact binary (e.g. `glyphs/inter-regular.json`).
- Optionally compress outputs and add a manifest listing the available styles and resource URLs.
- Hook this script into the project's build pipeline so new fonts regenerate the assets automatically.

## 2. Runtime Font Loader
- Replace the MSDF loader with a module that fetches the precomputed glyph geometry.
- Parse the stored buffers into typed arrays and cache them by font style.
- Expose an API like `resolveVectorFont({ family, weight, style })` returning metrics and glyph meshes.
- Remove the MSDF worker and associated atlas caching logic.

## 3. Update Layout & Measurement
- Reuse existing layout code but swap in the new metrics (advance, line height, kerning).
- Update `measureText` logic to rely solely on the precomputed data.
- Ensure underline/baseline positioning accounts for the new metrics.

## 4. Render Vector Glyphs in Pixi
- Introduce a `VectorTextVisual` to replace `BitmapText` usage in `StageCanvas`.
- For each glyph:
  - Reuse a shared `MeshGeometry` built from the precomputed vertices/indices.
  - Instantiate meshes with a simple solid-color shader.
  - Position meshes using the layout metrics inside a container.
- Scale/rotate the container for transforms; geometry remains sharp at any zoom.
- Cache glyph geometries per font style to avoid duplicating buffers.

## 5. Scene Integration
- Update selection, bounding boxes, and transform logic to use the container extents or metrics.
- Keep underline rendering in sync by drawing lines relative to the container coordinates.

## 6. State & Undo Support
- Remove MSDF-specific fields from the scene store and snapshots.
- Ensure font selections reference the new style identifiers only.

## 7. Asset Delivery
- Serve the prebuilt geometry files from `public/` (or an equivalent static path).
- Ensure loaders cache results (e.g. via `Assets` or custom fetch caching).
- Document the build step for adding new fonts.

## 8. Performance Considerations
- Monitor bundle size and runtime memory (geometry can be larger than MSDF atlases).
- Tune tessellation density; consider multiple LODs if necessary.
- Benchmark rendering performance with many glyphs onscreen.

## 9. Testing & Validation
- Compare output against the MSDF renderer at various zoom levels.
- Verify kerning, line height, alignment, and underline behavior.
- Stress-test giant font sizes and deep zoom to confirm “infinite” sharpness.
- Re-run interaction tests (editing, transforms, undo/redo).

## 10. Cleanup & Documentation
- Remove the MSDF worker, font resolver, and associated assets.
- Update developer docs to explain the new vector pipeline and build requirements.
- Communicate the change to downstream consumers (highlight truly unlimited text scaling).

