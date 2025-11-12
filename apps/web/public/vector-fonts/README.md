# Vector Font Assets

Precomputed glyph geometry is generated at build time and emitted into this directory.
Run the helper script from Windows to refresh the assets:

```bash
pnpm --filter web generate:vector-fonts
```

The generator reads Inter font files from `public/fonts` and produces JSON payloads the
runtime loader consumes. Generated files are committed alongside the manifest so the
canvas can render text without relying on MSDF atlases.
