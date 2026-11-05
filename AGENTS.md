# Linkarr

TypeScript + Vite, vanilla DOM, Chrome MV3. Only Radarr movies and Sonarr series are supported.

## Tooling and validation

Use `nix develop` (or the included direnv integration) if nix is available.

- `pnpm install --frozen-lockfile`
- `pnpm format` / `nix fmt` — treefmt is the formatting entry point.
- `pnpm check` — formatting, lint, typecheck, unit tests, and production build.
- `pnpm test:e2e` — actual extension, synthetic source pages, local mock API. Linux dev shell provides Chromium; macOS needs an existing executable via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.
- `pnpm audit --audit-level=high`
- `nix flake check`
- `pnpm package` — ZIP in `artifacts/`.

## Boundaries

- Keep API keys and full instance settings out of content scripts and page DOM. Only per-title navigation URLs may be exposed for native links. Local storage access is restricted to trusted extension contexts.
- Render add/search anchors without waiting for API calls. API keys are optional; automatic library checks can upgrade links but must never block clicks or remove the working fallback.
- Request only configured origins through optional host permissions; do not add broad required host or `tabs` permissions.
- No remotely hosted executable code, inline script, eval, library writes, automatic adding, downloading, deletion, or video playback.
- Prefer native external IDs; never guess existing library matches from ambiguous titles.
- Preserve reverse-proxy URL base paths. Never follow redirects carrying API keys.
- Never use production credentials or production Arr instances in tests.
- Site adapters and panel logic live in `src/content/`; all Arr network operations live in `src/background/`.
- Keep dependencies development-only unless runtime code truly needs one. The extension currently has no runtime dependencies.
- Version comes from `package.json`, maintained by Release Please. Do not edit generated `dist/` or ZIPs.
