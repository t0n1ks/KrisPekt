# KrisPekt

Handwritten notes organised by subject: a shelf of notebooks, stylus writing, PDFs and photos, all in the browser.

**Open the app:** https://t0n1ks.github.io/KrisPekt/

© 2026 t0n1ks. All rights reserved, view only: see [License](#license).

## Features

- **Shelf:** subjects and notebooks with coloured covers, search, reordering, a Trash kept for 30 days, a storage report, backups and automatic backups.
- **Writing:** pen with stylus pressure and five types (ballpoint, fountain, liner, pencil, brush), highlighter, point and stroke eraser, scratch-out to erase, hold to straighten a line, ruler, lasso (move across pages, resize, recolour, copy), undo and redo.
- **Palm rejection:** a resting hand neither scrolls nor draws. See [Palm rejection](#palm-rejection).
- **Text boxes:** rich text with size, bold, italic, underline, strikethrough, colour, alignment and lists.
- **Pages:** an organizer with thumbnails to insert, drag, duplicate and delete pages; per-page size and background; optional page titles.
- **Links and bookmarks:** see [Links and bookmarks](#links-and-bookmarks).
- **Attachments:** PDF cards with a built-in viewer, and web link cards.
- **Import and export:** PDF pages as backgrounds; export as vector PDF with selectable text and an outline, raster PDF (300 or 600 dpi), or PNG (2×, 4×, 6×; several pages as a ZIP).
- **Customisable toolbar:** up to 12 pinned tool presets, reordering, and an overflow for what does not fit.
- **Responsive:** from a 320 px phone to a wide desktop, in portrait and landscape, with 44 px touch targets.
- **Languages:** Ukrainian, Russian, German and English.

### Install on a phone or tablet

1. Open the link above in Chrome (Android) or Safari (iPhone, iPad).
2. Chrome: menu **⋮ → Add to Home screen**. Safari: **Share → Add to Home Screen**.
3. The app opens in its own window and works without internet.

## Privacy and offline use

- **Your notes stay on your device.** They are stored in the browser (IndexedDB). There is no account, no server, no analytics and no third-party request of any kind.
- **Nothing syncs.** To move notes to another device, use a backup: **⋯ → Save backup** on the shelf, then **⋯ → Restore from backup** on the other device.
- **Clearing site data removes your notes.** Keep a backup. Automatic backups download a file every 3 days by default, if anything changed.

## Security

- A strict Content Security Policy (`script-src 'self'`, `style-src 'self'`, `connect-src 'self'`, and so on) with no exceptions.
- User data never reaches `innerHTML`; markup from strings is limited to static SVG icons.
- Backups, images and PDFs are treated as hostile: the whole structure is validated before anything is written, file types are checked by signature, photos are re-encoded to strip EXIF and GPS data, and pdf.js runs without scripts or XFA.
- Data read back from IndexedDB is validated too; a damaged record is skipped.

## Tech stack

TypeScript in strict mode and Vite, with no UI framework: the interface is small classes over the DOM, and the core is a custom canvas renderer. Libraries: pdf.js (PDF reading), jsPDF (PDF writing), fflate (ZIP), Workbox through vite-plugin-pwa (offline). Tests: Vitest and Playwright. Fonts: Onest and Unbounded, bundled with the app.

## Development

Requires Node.js 24, the version CI uses.

```bash
npm ci             # install dependencies
npm run dev        # dev server: http://localhost:5173/KrisPekt/
npm test           # unit tests (Vitest)
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm run build      # build into dist/
npm run preview    # serve the build: http://localhost:4173/KrisPekt/
npm run test:e2e   # Playwright, after a build (first time: npx playwright install chromium)
```

Every push to `main` runs GitHub Actions: `npm ci`, `npm audit`, lint, unit tests, build, Playwright, then deployment to GitHub Pages.

The pixel comparison in `tests/e2e/render-parity.spec.ts` has separate baselines per system, because each draws text differently: Windows for local runs, Linux for CI. To redraw the Linux baselines, run the **Render baselines** workflow, then download them:

```bash
gh run download <run> -n render-baselines -D tests/e2e/render-parity.spec.ts-snapshots
```

To redraw the Windows baselines, run `npx playwright test render-parity --update-snapshots=all` on Windows.

Coding rules are in [CLAUDE.md](CLAUDE.md).

### Layout

```
src/
├─ main.ts       entry point
├─ app/          App (composition root), EventBus
├─ core/         types, constants, utilities
├─ i18n/         I18n and the uk/ru/de/en dictionaries
├─ storage/      IndexedDB, repositories, save queue, preferences, backups, validation
├─ domain/       pure logic, free of the DOM
├─ services/     shelf operations
├─ editor/       open notebook state, page operations, undo
├─ canvas/       camera, page layout, rendering, caches, brushes, draw commands
├─ input/        pointer routing, gestures, palm rejection input, shortcuts
├─ tools/        Tool base class, tools, ToolManager, selection, ruler
├─ features/     PDF import and export, PNG, image insertion, attachments, file saving
├─ ui/           icons, shelf, editor, dialogs, widgets
└─ styles/       tokens.css (colours, fonts, light and dark themes) and styles by area
tests/unit/      Vitest
tests/e2e/       Playwright
public/fonts/    Onest for text in PDFs, with its licence
reference/       the original prototype (neither built nor published)
```

## How it works

### Links and bookmarks

A link has two ends. The **target** is where it leads: a bookmark. The **source** is what carries it: a word or some ink.

- **Make link** creates a target. On a text selection, lassoed ink or an image, or an attachment card, it asks for a name and saves a bookmark, which then waits at the top of the recent list in the link dialog.
- **Insert link** creates a source. On selected text or lassoed ink, it opens the link dialog: a web address, or a place in your notes.
- **Removing a bookmark:** tap its marker for Rename, Copy link and Remove bookmark, or choose Remove bookmark here on a selection that contains one. If links lead there, the app says how many stop working. Removal can be undone.

Links store ids rather than page numbers, so moving pages does not break them. A bookmark on a selection moves with its items. A broken link shows in red with dashes, and tapping it offers to remove it. Duplicating a page copies its bookmarks with new ids, so existing links keep leading to the original.

In a vector PDF, links within the exported pages become jumps, and page titles and bookmarks become the document outline.

### Backups

A backup is one file, `krispekt-backup-YYYY-MM-DD.zip`:

```text
manifest.json          format version, date, counts, and the size and SHA-256 of each file
data.json              subjects, notebooks, pages, Trash; one page per line, read one page at a time
files/<sha256>.<ext>   photos and PDFs as they are; identical files are stored once
```

Restoring is all or nothing. The format is detected from the first bytes, every name, size, compression ratio, hash, file signature and the whole data structure are checked, and only then are records written in one transaction. Records with the same id are replaced and others stay. Old `.json` backups can still be restored, up to 300 MB. Limits are the `MAX_BACKUP_*` values in `constants.ts`.

### Palm rejection

The logic is the pure class `src/domain/TouchClassifier.ts`; the thresholds are in `src/core/constants.ts`.

- A touch wider or taller than 28 CSS px is a palm until it lifts, and its size is rechecked on every move.
- Any stylus event starts a 1.5 s writing session, in which one finger neither scrolls nor draws.
- One finger scrolls only after moving more than 10 px and no sooner than 80 ms. If the stylus lands during a one-finger scroll or within 700 ms after it, the page goes back to where it was.
- Three or more touches are ignored until all are lifted.

Input diagnostics: in the editor, **⋯ →** long-press **Draw with finger**. Nothing is stored or leaves the device.

### Scratch-out

Scribbling a zigzag over writing with the pen erases it. There is no handwriting recognition, only geometry: reversals, density, sideways step and winding tell a zigzag from "www" or a circled word. It can be tuned or turned off in **⋯**, and it is one undo step.

### Rendering and export

The screen and the vector PDF are drawn from the same commands (`src/canvas/draw/`), executed by `Canvas2DBackend` and `PdfVectorBackend`. Two differences: in a PDF the highlighter lies under the ink with transparency, because jsPDF has no multiply blend, and pencil grain becomes an even tone of the same density. Onest has no italic, so italics are slanted everywhere.

## License

Proprietary, all rights reserved. This repository is published for viewing only: you may read the source and use the app at the link above for personal, non-commercial purposes. Copying, modifying, redistributing or publishing the code or design without written permission is not allowed. See [LICENSE](LICENSE).
