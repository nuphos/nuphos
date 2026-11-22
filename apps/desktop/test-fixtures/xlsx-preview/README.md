# XLSX preview regression fixture

Uses real DownloadGroups, ArtifactView, SpreadsheetView and the ZIP worker, with
only the transfer API and dock event routing replaced by dummy fixtures. No user
files, credentials, cloud access, or running Desktop instance are needed.

From apps/desktop:

```sh
node_modules/.bin/vite --config vite.xlsx-preview.config.mjs
CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/test-xlsx-preview.mjs
node --experimental-strip-types --test src/lib/xlsxPreview.test.ts
```

The browser test uses port 52387 and writes light/dark screenshots to
`/tmp/nuphos-xlsx-preview-evidence` (override with XLSX_EVIDENCE_DIR). It rejects
external requests and checks keyboard opening, worksheet switching, virtualized
scrolling, empty sheets, inert formula/script content, separate downloads,
corrupt/oversized/unknown fallbacks, MIME recognition, unchanged Markdown preview and TXT download-only behavior.

The viewer reads saved values, not Excel formatting: date serials and numeric
values remain raw; merged cells, charts, images and styles are not rendered.
It does not calculate formulas, load external links or run macros. Only XLSX is
supported, not XLS/XLSM/XLSB. Limits reject the preview while preserving Download:
5 MiB input, 256 ZIP entries, 2 MiB per selected XML part, 8 MiB selected XML total,
20 sheets, 2,000 rows and 100 columns per sheet, 50,000 stored cells in total,
and 32,767 characters per cell. ZIP inflation runs in a disposable worker with a
5-second deadline. XML DOMParser parsing runs on the UI thread with the 8 MiB
input bound; it is outside the worker and its 5-second timeout. Rows are virtualized.

Production routing/authentication and the Electron download dialog are outside
this isolated component test. Both channel output files and assistant output
files use DownloadGroups. UploadedFilesCard is a separate existing read-only
list and is deliberately unchanged, as are Markdown/Text preview features.
