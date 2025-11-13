# Scene Normalization Plan

1. **Define normalization model**
   - Introduce workspace-wide representation for scene mantissa/exponent.
   - Decide how mantissa bounds and normalize factor map to existing camera expectations.
   - Specify data that must always remain in mantissa space (nodes, world transform, cached geometry).
   - **Notes (Step 1):** Added `apps/web/src/state/sceneNormalization.ts` with the shared data model. It mirrors CameraNormalizer’s defaults (`normalizeFactor = 2`, mantissa bounds 0.5–4) and provides helpers to create/clone/snapshot the state plus scale Vec2/Size2D values. These utilities will be imported by the store in Step 2 so undo/redo can capture `SceneNormalizationSnapshot` alongside the world transform. No integration yet; everything still compiles because the new module is unused.

2. **Augment store/state APIs**
   - Extend `WorldTransform`, history snapshots, and persistence paths with exponent tracking.
   - Wrap node/world mutation helpers so they operate in mantissa units and trigger renormalization.
   - **Notes (Step 2):** `SceneState` in `apps/web/src/state/scene.ts` stores `world: { position, scale }` and snapshots history via `SceneSnapshot`. Need to add `sceneExponent` (or similar) to both the world transform and root state so undo/redo, serialization, and selectors pick it up. Mutators like `translateSelected`, `scaleSelected`, etc., currently work directly on raw node positions/sizes, so we’ll need shared helpers to scale deltas when the renormalizer adjusts mantissa bounds. Also ensure `screenToWorld`, `worldToScreen`, and derived helpers accept the additional exponent parameter so callers don’t break.

3. **Implement scene renormalizer utility**
   - Build a shared helper that manages mantissa/exponent math for arrays of vectors/sizes.
   - Wire it into store mutations so scene data rebalances whenever thresholds are crossed.

4. **Synchronize camera and scene exponents**
   - Keep CameraNormalizer aware of scene exponent changes to avoid double-scaling.
   - Ensure coordinate conversions (`screenToWorld`, etc.) incorporate both exponents consistently.

5. **Update derived geometry pipelines**
   - Make selection overlays, marquee boxes, layout helpers, etc. read normalized values or re-normalize caches when the exponent shifts.

6. **Revise Pixi rendering flow**
   - Feed Pixi mantissa-scale coordinates and rely on the camera’s mantissa for the final render conversion.
   - Remove redundant exponent multiplications now covered by the scene renormalizer.

7. **Testing & validation**
   - Add unit coverage for the renormalizer and regression tests for the Stage zoom/pan extremes.
   - Document manual QA scenarios (10^12 zoom, translation limits, undo/redo).
