# Visual baselines

`node apps/desktop/e2e/shots.mjs --update` writes one PNG per state, theme, and
window size here; `--check` re-captures into `../shots/` and compares.

A baseline is only meaningful against the machine that produced it: font
rasterisation and GPU compositing differ between distributions and
architectures. Generate these under the **same conditions as the `e2e` job** —
`ubuntu-latest`, Xvfb, and the screen size in `.github/workflows/ci.yml` — commit
the result, and treat a local `--check` as advisory:

```bash
npm ci && npm run build:ui -w @gimlet-works/desktop
xvfb-run --auto-servernum --server-args="-screen 0 1280x900x24" \
  node apps/desktop/e2e/shots.mjs --update
```

Until a set is committed here, `--check` says there is nothing to compare and
exits non-zero rather than passing on an empty directory.

Each shot is captured with:

- a fresh profile (`--user-data-dir`) and `GIMLET_HOME`, so preferences and recents
  cannot leak between runs;
- animations and transitions disabled, caret hidden, scrollbars suppressed;
- `data-volatile` elements (durations, clock times) hidden;
- a tolerance of 16/255 per channel and 0.2% of pixels in the comparison, which
  absorbs antialiasing without hiding a moved control.
