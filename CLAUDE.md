# KrisPekt — coding rules for Claude

These rules apply to every change in this repository.

## 4. Coding rules

These rules apply to every file.

### Separation of concerns
- `index.html` contains **markup only**: the static app shell and one `<script type="module" src="/src/main.ts">`. It has no inline `<style>`, no inline `<script>` logic and no `style="..."` attributes.
- **CSS lives in `.css` files**, split by area (see the folder layout in README.md).
  - All colours, fonts, radii and shadows are CSS custom properties defined in `tokens.css`, with light and dark themes.
  - Components never use literal colours. The only exceptions are the "paper" colours drawn on the canvas, which are constants in `constants.ts`.
  - Class names follow a BEM-like style: `.tool-tray`, `.tool-tray__button`, `.tool-tray__button--active`.
- **TypeScript does not set static styles.** Inline styles from TS are allowed only for runtime geometry: positions, sizes and transforms of overlays, plus CSS variables such as `--cover-color`.
- **No user-facing strings in code.** Every label, toast, aria-label and placeholder goes through `i18n.t('key')`. Translations live in `src/i18n/locales/{uk,ru,de,en}.json`, copied from the `I18N` object in the prototype. All four files must have the same keys; a unit test enforces this.

### OOP and structure
- **One class per file**, with the file named after the class (`PenTool.ts` → `class PenTool`).
- **Single responsibility.**
  - A class either renders, handles input, stores data, or holds domain rules. It never does all of these.
  - Views never call IndexedDB directly; they use services and repositories.
- **Dependency injection through constructors.**
  - `App.ts` is the composition root: it creates the services and passes them in.
  - No hidden globals, no module-level mutable state, no singletons except what `App` owns.
- **Polymorphism for tools:**
  - An abstract `Tool` base class has `onPointerDown/Move/Up/Cancel`, `renderOverlay(ctx)` and `createOptionsPanel()`.
  - `PenTool`, `HighlighterTool`, `EraserTool`, `LassoTool` and `TextTool` extend it.
  - `ToolManager` switches between them. There are no `switch (tool)` chains spread across the code.
- **Views are classes** with `render()`, `update()` and `destroy()`, and they clean up their listeners in `destroy()`.
- **Domain logic is pure** and has no DOM access, so it can be unit tested. This covers page-size lock rules, preset matching, stroke geometry, eraser splitting, lasso hit-testing, history snapshots, plural rules and backup (de)serialization.
- **Communication:** components talk through method calls, or a small typed `EventBus` for cross-cutting events (`language-changed`, `page-changed`, `notebook-saved`). Do not reach into another component's DOM.

### TypeScript style
- `strict: true`, no `any` (use `unknown` and narrow it), no non-null `!` unless it is commented.
- Model types live in `core/types.ts`:
  - data: `Subject`, `Notebook`, `Page`, `Stroke`, `TextItem`, `ImageItem`;
  - settings and enums: `Preferences`, `Background`, `ToolKind`, `Language`.
- Keep functions under about 40 lines and classes focused. Extract helpers instead of nesting.
- Add JSDoc to every public method and to anything non-obvious, especially the *why*: palm-rejection timing, the cache key format, pointer-capture forwarding from the ruler.
- `const` by default. Use early returns. Use descriptive names (`pageLayout`, not `pl`).

### Errors and UX
- Every async storage, PDF or file operation catches its errors and shows a translated toast. Nothing fails silently, and nothing crashes the canvas.

### Git
- Use small, meaningful commits in Conventional Commits style (`feat:`, `refactor:`, `fix:`, `chore:`, `test:`, `docs:`).
- Commit at the end of every phase in section 7.

## 4A. Repository hygiene: commit only what belongs in the project

The repository is **public**. Anything pushed can be seen and copied by anyone, forever. Removing a file later does not remove it from history.

### Never commit
- `node_modules/`, `dist/`, `dev-dist/`, `coverage/`, `playwright-report/`, `test-results/`, `.vite/`, caches.
- Secrets of any kind: `.env*`, tokens, keys, passwords, `*.pem`, `*.key`, `.npmrc` with a token. The app needs **no secrets at all**. If something seems to need one, stop and ask the owner.
- Personal or private data: user backups (`krispekt-*.json`, `konspekty-*.json`), PDFs, photos, screenshots, notes, exports.
- Editor, OS and tool clutter: `.vscode/` (except a shared `extensions.json` if useful), `.idea/`, `Thumbs.db`, `desktop.ini`, `.DS_Store`, `*.log`, `*.tmp`, `*.local`.
- Throwaway scripts (icon generators, one-off converters) and scratch files.
- The owner's local brief files (they are in `.gitignore`). `CLAUDE.md` is fine to commit; it contains only coding rules.

### What belongs in the repository
- Source (`src/`, `index.html`, `public/`).
- Tests.
- Config files: `package.json`, `package-lock.json` (always commit the lockfile), `tsconfig.json`, `vite.config.ts`, lint/format config, `.editorconfig`, `.gitignore`.
- The `.github/` folder.
- `README.md`, `CLAUDE.md`, `LICENSE` (ask the owner which licence; default to MIT if they have no preference).
- `reference/prototype.html`.

### How to commit
- Write `.gitignore` **before** the first `git add`.
- Never use `git add .` or `git add -A` blindly. Before every commit, run `git status` and `git diff --cached --stat`, and check that every staged file is intended. Flag any file over 1 MB that is not an intended asset.
- Before the first push, scan for secrets (for example `npx gitleaks detect --no-git -v`, or `gitleaks` if installed). Repeat the scan before later pushes.
- **Author email:**
  - Commits show the author email publicly.
  - Before the first commit, ask the owner whether to use their GitHub no-reply address (`<id>+<username>@users.noreply.github.com`) for this repository: `git config user.email ...` in this repository only.
  - Recommend they enable GitHub → Settings → Emails → "Block command line pushes that expose my email".
- Never force-push to `main` and never rewrite published history without asking the owner.
- If a secret or personal file ever gets pushed, stop and tell the owner immediately. Do not try to hide it with a new commit. The secret must be revoked, and history cleaned in agreement with the owner.

## 4B. Security: the app must not become a way to attack its users

KrisPekt runs entirely in the user's browser and stores data locally. The main risks are:
- **XSS:** malicious content from a backup file, PDF, image or text being executed as code;
- **supply chain:** vulnerable or compromised dependencies, or CI;
- **data leaks to third parties.**

Treat these rules as mandatory.

### 1. Never turn data into code or markup
- User data must never reach `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or `Element.setAttribute('on…')`. User data includes subject and notebook names, text boxes, anything from backups, file names and translations.
- Render user data with `textContent`, `value`, or canvas `fillText`.
- `innerHTML` is allowed **only** for static, hard-coded SVG icon strings from `icons.ts`.
- Banned in the codebase: `eval`, `new Function`, string arguments to `setTimeout`/`setInterval`, `javascript:` URLs. Enforce this with ESLint (`no-eval`, `no-implied-eval`, `no-new-func`, `no-restricted-properties`/`no-restricted-syntax` for `innerHTML` outside `icons.ts`).

### 2. Content Security Policy
GitHub Pages cannot set HTTP headers, so add a CSP `<meta>` tag in `index.html`, as strict as the app allows:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:;
font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none';
base-uri 'self'; form-action 'none'; manifest-src 'self'
```

- Make sure the production build has **no inline scripts**: configure vite-plugin-pwa with `injectRegister: 'script'` or register through its virtual module, not `'inline'`.
- If something is blocked, fix the code instead of loosening the policy. If a loosening is truly unavoidable (for example `'unsafe-inline'` for styles), document why in the README.
- Verify the policy in the built app with DevTools: there must be no CSP violations.

### 3. Treat every imported file as hostile
- **Backup JSON:**
  - Check the file size before reading (reject over 300 MB) and parse inside `try/catch`.
  - Validate the **whole** structure with strict type guards or a schema library such as `zod`, and reject the file on any mismatch. Do not partly import it.
  - Required formats:
    - IDs: `/^[a-z0-9]{1,40}$/i`;
    - colours: `/^#[0-9a-f]{6}$/i`;
    - numbers: finite and within sane ranges (page sizes 40–1200 mm, font size 6–200, coordinates within ±100000);
    - text: strings with sane maximum lengths;
    - `bg`: one of the known backgrounds;
    - blob MIME types: only `image/jpeg`, `image/png`, `image/webp`;
    - base64: valid, and blobs under 25 MB each.
  - Drop unknown fields.
  - Write to IndexedDB only after the whole file validates.
- **Images:**
  - Accept only `image/jpeg`, `image/png` and `image/webp`, and check the type by magic bytes, not only by the extension.
  - Limit the size (for example 25 MB).
  - Decode with `createImageBitmap`, then re-encode to JPEG through a canvas, as the prototype does. This strips metadata (EXIF and GPS location).
  - Never accept SVG.
- **PDF:**
  - Check the `%PDF-` header and limit the size (for example 200 MB) and the page count (for example 500).
  - **Disable code execution in pdf.js:** pass `isEvalSupported: false` and `enableXfa: false` to `getDocument`. Never enable JavaScript or forms and never render annotation layers; the app only rasterises pages to images.
  - pdfjs-dist versions before 4.2.67 have a known arbitrary-code-execution issue (CVE-2024-4367). Prefer upgrading to the latest pdfjs-dist 4.x/5.x and adapting the worker import (see section 3). If you must stay on 3.11.174, `isEvalSupported: false` is **required**.
- **jsPDF:** use the latest stable version that `npm audit` reports clean. The app uses only `new jsPDF`, `addPage`, `addImage` and `output('blob')`, which are stable across versions. Only ever pass it images the app generated itself.

### 4. No data leaves the device
- No analytics, trackers, ads, external fonts, external scripts or CDNs. The CSP enforces this (`connect-src 'self'`).
- No `fetch` to third-party hosts. The app has no backend and must not send user data anywhere.
- The service worker caches only same-origin GET requests and never caches anything with credentials.
- Do not read URL query or hash parameters into the app state.

### 5. Dependencies and CI (supply chain)
- Keep dependencies minimal. Every new package needs a reason in the commit message.
- Commit `package-lock.json` and use `npm ci` in CI. Pin exact versions (`save-exact=true` in a committed `.npmrc` that contains **no tokens**).
- CI runs `npm audit --audit-level=high` and **fails** on high or critical issues.
- Add `.github/dependabot.yml` for `npm` and `github-actions` (weekly).
- **GitHub Actions:**
  - `permissions:` least privilege: `contents: read` at the top, and `pages: write` + `id-token: write` only on the deploy job.
  - Use only official `actions/*` actions, pinned to a full commit SHA (with the version in a comment).
  - No `pull_request_target`, no secrets, no third-party actions.
- Once the repository exists, tell the owner to:
  - check that **Secret scanning** and **Push protection** are on (Settings → Code security);
  - protect the `main` branch (no force-push, no deletion).

### 6. Defensive coding
- Wrap all IndexedDB, file and PDF operations in error handling. Corrupted or unexpected stored data must not crash the app: skip the bad record and show a toast.
- Validate data read **from IndexedDB** with the same type guards before rendering. The data could have been written by an older version or tampered with.
- Clamp all user-provided numbers (zoom, sizes, slider values).
- Revoke object URLs after use. Never put user data into URLs.

## Project decisions

- Licence: proprietary, all rights reserved, view-only (see `LICENSE`). Never add an open-source licence or badge.
- No AI attribution in commits or PRs (no `Co-Authored-By` trailers, no "Generated with" lines).
- Commit author email: the GitHub no-reply address configured in this repository.
