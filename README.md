# Linkarr

A small Chrome Manifest V3 extension that connects movie and TV content pages on **IMDb, TMDB, TVDB, and MDBList** to your **Radarr and Sonarr** instances.

- Multiple instances of either service, with separate names, ordering, and enable switches.
- Per-instance custom icon URLs, including distinct HD/4K icons. Icons are downloaded once, rasterized, and cached locally.
- Compact instance icons beside the page title, showing only instances for the current media type. IMDb uses its main `h1`, TMDB its header title `h2`, TVDB `#series_title`, and MDBList its main title heading.
- Icons are working native **add/search links immediately**, without API access. With an optional API key, background library checks silently update each link to the existing title’s **detail page** when found. Clicking never waits for a lookup; middle-click and copy-link work normally. It does not open a video player or a local filesystem path.
- Connection testing, local-only settings, and a popup for pausing page links or opening your servers.

## Develop

All tools are provided by the locked Nix flake. Nothing needs to be installed globally.

```nu
nix develop
pnpm install --frozen-lockfile
pnpm build
```

Alternatively, enable the included `.envrc` with direnv. Node 24 and pnpm 10 are pinned through `flake.lock`; `pnpm-lock.yaml` pins project dependencies.

### Load in Chrome

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this project's `dist/` directory.
3. In Linkarr settings, add your instances. **API keys are optional**; add one from Settings → General → Security to enable automatic links to existing titles.
4. Save settings. If you configured API keys, approve host access for automatic library checks, or decline and keep using add/search links. Instances without keys do not need API host access.
5. Visit a supported movie or series detail page and choose an instance icon beside the title. Hover an icon to see its instance name.

Instance URLs may include ports and reverse-proxy base paths, such as `http://localhost:7878` or `https://media.example.com/radarr`. Do not include `/api`, `/movie`, or `/add/new`. Use HTTPS outside a trusted local network. Self-signed certificates must be trusted by Chrome; Linkarr never disables certificate validation. Reverse proxies must allow API-key authentication without an interactive login or redirect.

For a custom icon, expand **Custom icon**, enter the image URL, click **Load icon**, then save. The image must be at most 1 MiB; redirects are rejected, so use a direct image URL. Default letter badges are original artwork, not upstream application logos.

### Watch mode

Run `pnpm build` once, then use separate Nix-shell terminals:

```nu
pnpm dev
pnpm dev:ui
```

The first watches the content script and the second watches the settings/popup UI. Rebuild with `pnpm build` after background-worker changes. Reload the extension in Chrome after a build, then refresh open content pages. No development server or remotely hosted code is needed.

## Check and package

```nu
pnpm format
pnpm check
pnpm test:e2e
pnpm audit --audit-level=high
nix flake check
pnpm package
```

`pnpm format` delegates to treefmt (Biome, Prettier for documents/HTML/YAML, nixfmt, and actionlint). `pnpm check` runs formatting, linting, strict TypeScript checks, unit tests, and all production builds. `pnpm build` generates the extension icons before bundling, so no pre-existing assets are needed. The ZIP is written to `artifacts/linkarr-<version>.zip` with `manifest.json` at its root and without source maps. `dist/` remains suitable for unpacked installation and includes source maps for debugging.

The E2E suite runs the actual built extension in an isolated Chromium profile against synthetic source pages and a local mock Arr API; it never uses production services or credentials. On Linux the Nix dev shell supplies Chromium. On macOS, point Playwright at an existing Chromium executable:

```nu
$env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = '/path/to/Chromium.app/Contents/MacOS/Chromium'
pnpm test:e2e
```

Use Chromium rather than branded Chrome, whose newer builds restrict command-line extension loading. Browser tests pre-grant only their temporary mock API origin in a temporary manifest; actual optional permission prompts are tested manually in Chrome. Live source-site HTML may change or be blocked by anti-bot protection; fixtures do not prove the current live markup of every site.

## How it works

- `src/content/`: site adapters and Shadow DOM title links; only per-title navigation URLs, never API keys or full settings, are exposed here.
- `src/background/`: MV3 service worker, immediate navigation URL generation, and optional read-only Arr API checks.
- `src/options/`, `src/popup/`: extension-local configuration and controls.
- `src/shared/`: strict settings and message-boundary validation.
- `tests/unit/`, `tests/e2e/`: domain/DOM coverage and real-browser extension integration tests.

Native TMDB movie and TVDB series IDs are preferred; IMDb IDs match library records directly. Where the source only provides a title (for example some TVDB movie/MDBList pages or TMDB series pages without external links), an exact, unambiguous title/year lookup resolves the relevant native ID first. Ambiguous results leave the original add/search link unchanged rather than choosing a potentially wrong existing title. Individual episodes, seasons, search results, and list pages are intentionally excluded.

Links appear as soon as the title and saved settings are available, before any network request completes. Instances with keys and granted host access are checked automatically and independently. Only a confirmed existing title changes the link’s `href`; missing titles, ambiguous matches, missing permissions, API errors, and timeouts all silently retain the original add/search destination. There are no loading states, disabled links, click-time checks, or periodic library polling. Use **Test connection** in settings for explicit diagnostics. Late results for a previous title are discarded. A title being monitored or having a downloaded file does not affect the destination: any confirmed existing library record opens its detail page.

## Privacy and permissions

- Required permission: `storage`. Content scripts run only on the four supported HTTPS source hosts. No `tabs`, `activeTab`, analytics, tracking, or remote JavaScript permission is used.
- HTTP(S) hosts are declared **optional** because users can configure arbitrary servers and icon sources. Chrome grants only the origins explicitly approved in settings. Host permission is origin-wide, even if your instance uses a subpath.
- API keys and full instance settings remain in trusted extension-local storage, not browser sync, site DOM, or content-script settings. Native links necessarily expose their configured server’s per-title navigation URL to the page; keys are never included in those URLs. Stored keys are not encrypted at rest; protect your Chrome profile. Keys are sent only to their configured instance in `X-Api-Key` headers, never query parameters. Plain HTTP is unencrypted on the network.
- Custom icon sources receive a request when you explicitly load an icon, without credentials. Pages only receive cached PNG data. A site's restrictive image CSP can block that data; the named letter-badge button remains usable.
- No library writes, automatic additions, downloads, deletion, telemetry, or periodic library polling. Optional background checks run when title links are created or settings change. Existing Chrome sessions still need to be authenticated to view an instance's UI.
- Removed hosts may retain their Chrome permission. Revoke unused access from Chrome's extension site-access controls.

## Releases

Use Conventional Commits and descriptive conventional PR titles. Release Please maintains `package.json`, its manifest, changelog, tags, and GitHub releases. The extension manifest and package filename derive from the package version at build time; there is no second runtime version to edit. The Release Please workflow runs on pushes to `master` and uses the repository secret `RELEASE_PLEASE_TOKEN` so release PRs trigger CI automatically. When it creates a release, a publish job in the same workflow checks out the release tag, runs all checks, packages the extension, and attaches the ZIP to that GitHub release. CI handles branch and PR checks only; all release packaging and publishing stays in the Release Please workflow. Uploading to the Chrome Web Store is a separate manual step.
