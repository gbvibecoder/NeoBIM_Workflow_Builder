# Brief-to-Renders editorial PDF — font assets

Phase 5's PDF compile worker registers Inter Regular + Inter Bold via
`jspdf.addFileToVFS()` so the editorial deliverable matches the brand
typography in the reference layout. Place the TTFs alongside this
README:

```
public/fonts/
├── inter-regular.ttf      ← required (drop in before deploy)
├── inter-bold.ttf         ← required (drop in before deploy)
└── README.md              ← this file
```

## Source

[Inter](https://github.com/rsms/inter) by Rasmus Andersson. Licensed
under the **SIL Open Font License 1.1**, which permits commercial use
including bundling inside a deployed application.

Download the latest stable release as `Inter-3.x.zip`. Inside, the
canonical files are:

- `Inter Hinted for Windows/Web/Inter-Regular.ttf`
- `Inter Hinted for Windows/Web/Inter-Bold.ttf`

Rename to lowercase (`inter-regular.ttf`, `inter-bold.ttf`) and commit
into this directory. Total binary footprint ≈ 320 KB.

## Behaviour without the TTFs

`pdf-fonts.ts` falls back to jspdf's bundled Helvetica when either file
is missing at registration time. Helvetica handles latin-1 (German
umlauts ä / ö / ü / ß via WinAnsi encoding) but with weaker editorial
finish — kerning, weight balance, and italic style differ from Inter.
The fallback is acceptable for development and degraded production
deployments, never aesthetically ideal.

The `pdf-fonts.registerInterFont()` helper returns
`{ family, interLoaded }`. Stage 4 folds `interLoaded === false` into
its `endStage` summary so the degradation surfaces in the job's stage
log without polluting the server console.

## Operational checklist before first production compile

- [ ] `public/fonts/inter-regular.ttf` committed.
- [ ] `public/fonts/inter-bold.ttf` committed.
- [ ] Smoke-test a Marx12 compile and visually confirm the cover title
      uses Inter, not Helvetica.
- [ ] `git status` shows the two binaries staged.
