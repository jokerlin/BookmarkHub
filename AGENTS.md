# Repository Guidelines

## Project Structure & Module Organization
- Source in `src/`:
  - `entrypoints/` (browser extension surfaces): `background.ts`, `popup/`, `options/`.
  - `utils/` (services, models, settings), `assets/` (icons), `public/_locales/` (i18n).
- Build/config: `wxt.config.ts`, `tsconfig.json`.
- Docs and media: `README.md`, `images/`.

## Build, Test, and Development Commands
- `pnpm install` — install dependencies.
- `pnpm dev` — start WXT dev server (Chrome by default).
- `pnpm dev:firefox` — start dev server targeting Firefox.
- `pnpm build` / `pnpm build:firefox` — production build.
- `pnpm zip` / `pnpm zip:firefox` — package distributable archive.
- `pnpm compile` — TypeScript type‑check without emitting.

## Coding Style & Naming Conventions
- Language: TypeScript and React (`.ts`, `.tsx`).
- Indentation: 2 spaces; single quotes; end statements with semicolons.
- Components: PascalCase (e.g., `Popup`); variables/functions: camelCase.
- File layout: co‑locate UI assets and styles (e.g., `entrypoints/popup/popup.css`).
- Avoid committing runtime secrets; use options storage for tokens.

## Testing Guidelines
- No test runner configured. Ensure `pnpm compile` passes and manually verify flows:
  - Popup actions (upload/download/remove) and Options page.
  - Background events (badge updates, notifications).
- If adding tests, prefer lightweight setup (e.g., vitest) and place under `tests/` mirroring `src/`.

## Commit & Pull Request Guidelines
- Commits: short imperative subject (e.g., "fix: update Chrome Store URL"); reference issues with `#123` when applicable.
- PRs must include:
  - Summary of changes and rationale.
  - Steps to verify (commands, expected UI/behavior) and screenshots/GIFs for popup/options.
  - Any i18n updates under `src/public/_locales/`.

## Security & Configuration Tips
- Configure GitHub Gist sync in Options: `githubToken`, `gistID`, `gistFileName`.
- Do not commit personal tokens or gists; values are stored via `webext-options-sync`.
- Host permissions are defined in `wxt.config.ts`; request the minimum needed.
