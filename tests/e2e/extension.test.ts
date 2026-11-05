import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from "@playwright/test";
import type { Instance, Settings } from "../../src/shared/settings";

let context: BrowserContext;
let worker: Worker;
let root: string;
let extensionId: string;
let origin: string;
let server: Server;
let library: unknown[] = [];
let apiStatus = 200;
let networkFailure = false;
let invalidJson = false;
let gate: Promise<void> | null = null;
let gatePrefix = "";
let release: () => void = () => undefined;
const requests: { path: string; key: string | undefined }[] = [];
const completed: string[] = [];
const movieUrl = "https://www.imdb.com/title/tt2543164/";
const seriesUrl = "https://www.imdb.com/title/tt0903747/";
const existingMovie = {
  title: "Arrival",
  year: 2016,
  tmdbId: 329865,
  imdbId: "tt2543164",
  titleSlug: "arrival-329865",
};
const existingSeries = {
  title: "Breaking Bad",
  year: 2008,
  tvdbId: 81189,
  imdbId: "tt0903747",
  titleSlug: "breaking-bad",
};
const moviePage =
  '<html lang="en"><head><title>Arrival</title><script type="application/ld+json">{"@type":"Movie","name":"Arrival","datePublished":"2016-01-01"}</script></head><body><h1 data-testid="hero__pageTitle"><span>Arrival</span></h1></body></html>';
const seriesPage =
  '<html lang="en"><head><title>Breaking Bad</title><script type="application/ld+json">{"@type":"TVSeries","name":"Breaking Bad","datePublished":"2008-01-01","sameAs":["https://www.imdb.com/title/tt0903747/"]}</script></head><body><h1 id="series_title" data-testid="hero__pageTitle">Breaking Bad</h1><div id="series_basic_info"><ul><li><strong>TheTVDB.com Series ID</strong><span>81189</span></li></ul></div></body></html>';

function sitePage(host: string, series: boolean): string {
  const title = series ? "Breaking Bad" : "Arrival";
  const heading =
    host === "www.themoviedb.org"
      ? `<section class="header"><div class="title"><h2><a>${title}</a></h2></div></section>`
      : host === "www.thetvdb.com"
        ? `<h1 id="series_title">${title}</h1>`
        : `<main><h1>${title}</h1></main>`;
  return (series ? seriesPage : moviePage)
    .replace(/<h1[^>]*>.*?<\/h1>/, heading)
    .replace("<body>", "<body><header><h1>Navigation</h1></header>");
}

function holdApi(prefix = ""): void {
  gatePrefix = prefix;
  gate = new Promise<void>((done) => {
    release = done;
  });
}

async function configure(patches: (Partial<Instance> & { id: string })[]): Promise<void> {
  await worker.evaluate(async (updates) => {
    const stored = await chrome.storage.local.get("linkarr.settings");
    const settings = stored["linkarr.settings"] as Settings;
    settings.instances = settings.instances.map((instance) => ({
      ...instance,
      ...updates.find((update) => update.id === instance.id),
    }));
    await chrome.storage.local.set({ "linkarr.settings": settings });
  }, patches);
}

async function openLink(page: Page, name: string): Promise<Page> {
  const opened = context.waitForEvent("page");
  await page.getByRole("link", { name, exact: true }).click();
  return opened;
}

test.beforeAll(async () => {
  const icon = await readFile(resolve("public/icons/128.png"));
  server = createServer((request, response) => {
    const path = request.url ?? "";
    requests.push({
      path,
      key:
        typeof request.headers["x-api-key"] === "string" ? request.headers["x-api-key"] : undefined,
    });
    response.on("finish", () => completed.push(path));
    if (path === "/icon.png") {
      response.setHeader("Content-Type", "image/png");
      response.end(icon);
      return;
    }
    response.setHeader("Content-Type", "application/json");
    if (!path.includes("/api/v3/")) {
      response.end("{}");
      return;
    }
    const wait = path.startsWith(gatePrefix) ? gate : null;
    const status = apiStatus;
    const fail = networkFailure;
    const body = invalidJson
      ? "<html>Sign in</html>"
      : JSON.stringify(
          path.endsWith("system/status") ? { appName: "Radarr", version: "5.0.0" } : library,
        );
    void (async () => {
      if (wait) await wait;
      if (fail) {
        response.destroy();
        return;
      }
      response.statusCode = status;
      response.end(body);
    })();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test API did not start.");
  origin = `http://127.0.0.1:${address.port}`;
  root = await mkdtemp(join(tmpdir(), "linkarr-e2e-"));
  const extension = join(root, "extension");
  await cp(resolve("dist"), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, "manifest.json"), "utf8"));
  manifest.host_permissions = [`${origin}/*`];
  manifest.content_scripts[0].js.push("privacy-probe.js");
  await writeFile(
    join(extension, "privacy-probe.js"),
    `
    (async () => {
      try { await chrome.storage.local.get("linkarr.settings"); document.documentElement.dataset.storageAccessible = "true"; }
      catch { document.documentElement.dataset.storageAccessible = "false"; }
      const reply = await chrome.runtime.sendMessage({ type: "get-settings" });
      document.documentElement.dataset.publicSettings = JSON.stringify(reply);
    })();
  `,
  );
  await writeFile(join(extension, "manifest.json"), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(root, "profile"), {
    channel: "chromium",
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {}),
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      "--no-first-run",
    ],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
  await context.route("https://www.imdb.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: route.request().url().includes("tt0903747") ? seriesPage : moviePage,
    }),
  );
  for (const host of ["www.themoviedb.org", "www.thetvdb.com", "mdblist.com"]) {
    await context.route(`https://${host}/**`, (route) =>
      route.fulfill({
        contentType: "text/html",
        body: sitePage(host, /\/(tv|show|series)\//.test(new URL(route.request().url()).pathname)),
      }),
    );
  }
});

test.afterEach(async () => {
  release();
  for (const page of context.pages()) await page.close();
});

test.afterAll(async () => {
  release();
  await context?.close();
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (root) await rm(root, { recursive: true, force: true });
});

test.beforeEach(async () => {
  library = [];
  apiStatus = 200;
  networkFailure = false;
  invalidJson = false;
  gate = null;
  gatePrefix = "";
  release = () => undefined;
  requests.length = 0;
  completed.length = 0;
  await worker.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({
      "linkarr.settings": {
        version: 1,
        enabled: true,
        instances: [
          {
            id: "hd",
            name: "Movies HD",
            service: "radarr",
            baseUrl: `${baseUrl}/radarr`,
            apiKey: "local-test-key",
            enabled: true,
            iconUrl: "",
            iconData: "",
          },
          {
            id: "4k",
            name: "Movies 4K",
            service: "radarr",
            baseUrl: `${baseUrl}/4k`,
            apiKey: "other-test-key",
            enabled: true,
            iconUrl: "",
            iconData: "",
          },
          {
            id: "tv",
            name: "TV",
            service: "sonarr",
            baseUrl: `${baseUrl}/sonarr`,
            apiKey: "tv-test-key",
            enabled: true,
            iconUrl: "",
            iconData: "",
          },
        ],
      },
    });
  }, origin);
});

test("renders initial add links before the API responds, then silently upgrades hrefs", async () => {
  library = [existingMovie];
  holdApi();
  const page = await context.newPage();
  await page.goto(movieUrl);
  const link = page.getByRole("link", { name: "Movies HD", exact: true });
  await expect(link).toHaveAttribute("href", `${origin}/radarr/add/new?term=imdb%3Att2543164`);
  await expect(page.locator('h1[data-testid="hero__pageTitle"] > #linkarr-panel')).toBeVisible();
  await expect(page.locator("#linkarr-panel")).toHaveCSS("position", "static");
  await expect(page.getByRole("link", { name: "TV", exact: true })).toHaveCount(0);
  await link.evaluate((element) => {
    element.setAttribute("data-stable", "yes");
  });
  await expect.poll(() => requests.filter((item) => item.path.includes("/api/v3/")).length).toBe(2);
  release();
  await expect(link).toHaveAttribute("href", `${origin}/radarr/movie/arrival-329865`);
  await expect(link).toHaveAttribute("data-stable", "yes");
  await expect(link).not.toHaveAttribute("aria-busy");
  await expect(page.locator("#linkarr-panel button, #linkarr-panel [role=status]")).toHaveCount(0);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${origin}/radarr/movie/arrival-329865`);
  expect(requests.filter((item) => item.path === "/radarr/api/v3/movie")).toHaveLength(1);
});

test("upgrades Verity from MDBList's real scorecard IDs without a title lookup", async () => {
  const fixture = await readFile("tests/fixtures/mdblist-verity.html", "utf8");
  library = [
    { title: "Verity", year: 2026, tmdbId: 999, titleSlug: "other-verity" },
    {
      title: "Verity",
      year: 2026,
      tmdbId: 1283515,
      imdbId: "tt32261958",
      titleSlug: "verity-1283515",
    },
  ];
  holdApi();
  const page = await context.newPage();
  await page.route("https://mdblist.com/movie/3fsqj-verity", (route) =>
    route.fulfill({ contentType: "text/html", body: fixture }),
  );
  await page.goto("https://mdblist.com/movie/3fsqj-verity");
  const link = page.getByRole("link", { name: "Movies HD", exact: true });
  await expect(link).toHaveAttribute("href", `${origin}/radarr/add/new?term=tmdb%3A1283515`);
  release();
  await expect(link).toHaveAttribute("href", `${origin}/radarr/movie/verity-1283515`);
  expect(requests.some((item) => item.path === "/radarr/api/v3/movie?tmdbId=1283515")).toBe(true);
  expect(requests.some((item) => item.path.includes("/lookup"))).toBe(false);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${origin}/radarr/movie/verity-1283515`);
});

test("clicks are never blocked by a pending lookup", async () => {
  library = [existingMovie];
  holdApi();
  const page = await context.newPage();
  await page.goto(movieUrl);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${origin}/radarr/add/new?term=imdb%3Att2543164`);
  release();
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toHaveAttribute(
    "href",
    `${origin}/radarr/movie/arrival-329865`,
  );
});

test("works without API keys and makes no library requests", async () => {
  await configure([
    { id: "hd", apiKey: "" },
    { id: "4k", apiKey: "" },
  ]);
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toHaveAttribute(
    "href",
    `${origin}/radarr/add/new?term=imdb%3Att2543164`,
  );
  const destination = await openLink(page, "Movies 4K");
  await expect(destination).toHaveURL(`${origin}/4k/add/new?term=imdb%3Att2543164`);
  expect(requests.filter((item) => item.path.includes("/api/v3/"))).toHaveLength(0);
});

test("keeps absent movies on their initial search links", async () => {
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect.poll(() => completed.filter((path) => path.includes("/api/v3/")).length).toBe(2);
  const destination = await openLink(page, "Movies 4K");
  await expect(destination).toHaveURL(`${origin}/4k/add/new?term=imdb%3Att2543164`);
  expect(
    requests.some((item) => item.path === "/4k/api/v3/movie" && item.key === "other-test-key"),
  ).toBe(true);
});

for (const status of [401, 403, 500]) {
  test(`silently retains usable links after API HTTP ${status}`, async () => {
    apiStatus = status;
    const page = await context.newPage();
    await page.goto(movieUrl);
    await expect.poll(() => completed.filter((path) => path.includes("/api/v3/")).length).toBe(2);
    await expect(page.locator("#linkarr-panel [role=status]")).toHaveCount(0);
    const destination = await openLink(page, "Movies HD");
    await expect(destination).toHaveURL(`${origin}/radarr/add/new?term=imdb%3Att2543164`);
  });
}

test("uses the default link when the API is unreachable", async () => {
  networkFailure = true;
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect
    .poll(() => requests.filter((item) => item.path.includes("/api/v3/")).length)
    .toBeGreaterThanOrEqual(2);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${origin}/radarr/add/new?term=imdb%3Att2543164`);
});

test("uses the default link if a proxy returns HTML instead of JSON", async () => {
  invalidJson = true;
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect.poll(() => completed.filter((path) => path.includes("/api/v3/")).length).toBe(2);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${origin}/radarr/add/new?term=imdb%3Att2543164`);
});

test("does not need API host permission to render or follow links", async () => {
  const ungranted = origin.replace("127.0.0.1", "localhost");
  await configure([
    { id: "hd", baseUrl: `${ungranted}/radarr` },
    { id: "4k", apiKey: "" },
  ]);
  expect(
    await worker.evaluate(
      (url) => chrome.permissions.contains({ origins: [`${url}/*`] }),
      ungranted,
    ),
  ).toBe(false);
  const page = await context.newPage();
  await page.goto(movieUrl);
  const destination = await openLink(page, "Movies HD");
  await expect(destination).toHaveURL(`${ungranted}/radarr/add/new?term=imdb%3Att2543164`);
  expect(requests.filter((item) => item.path.includes("/api/v3/"))).toHaveLength(0);
});

test("a slow instance does not delay another instance's link upgrade", async () => {
  library = [existingMovie];
  holdApi("/radarr/");
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect(page.getByRole("link", { name: "Movies 4K", exact: true })).toHaveAttribute(
    "href",
    `${origin}/4k/movie/arrival-329865`,
  );
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toHaveAttribute(
    "href",
    `${origin}/radarr/add/new?term=imdb%3Att2543164`,
  );
});

test("keeps keys and full settings inaccessible to content scripts", async () => {
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-storage-accessible", "false");
  const publicData = await page.locator("html").getAttribute("data-public-settings");
  expect(publicData).toContain("Movies HD");
  expect(publicData).not.toContain("local-test-key");
  expect(publicData).not.toContain(origin);
  expect(await page.content()).not.toContain("local-test-key");
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("linkarr.settings");
    (stored["linkarr.settings"] as Settings).enabled = false;
    await chrome.storage.local.set(stored);
  });
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toHaveCount(0);
});

for (const source of [
  { name: "IMDb series", url: seriesUrl, series: true },
  { name: "TMDB movie", url: "https://www.themoviedb.org/movie/329865-arrival", series: false },
  { name: "TMDB series", url: "https://www.themoviedb.org/tv/1396-breaking-bad", series: true },
  { name: "TVDB movie", url: "https://www.thetvdb.com/movies/arrival", series: false },
  { name: "TVDB series", url: "https://www.thetvdb.com/series/breaking-bad", series: true },
  { name: "MDBList movie", url: "https://mdblist.com/movie/abc-arrival", series: false },
  { name: "MDBList series", url: "https://mdblist.com/show/8plj-breaking-bad", series: true },
]) {
  test(`automatically upgrades title links on ${source.name}`, async () => {
    library = [source.series ? existingSeries : existingMovie];
    const page = await context.newPage();
    await page.goto(source.url);
    const heading = source.url.includes("themoviedb.org")
      ? ".header .title h2"
      : source.url.includes("thetvdb.com")
        ? "#series_title"
        : source.url.includes("mdblist.com")
          ? "main h1"
          : 'h1[data-testid="hero__pageTitle"]';
    await expect(page.locator(`${heading} > #linkarr-panel`)).toBeVisible();
    await expect(page.locator("#linkarr-panel")).toHaveCSS("position", "static");
    const target = `${origin}/${source.series ? "sonarr/series/breaking-bad" : "radarr/movie/arrival-329865"}`;
    await expect(
      page.getByRole("link", { name: source.series ? "TV" : "Movies HD", exact: true }),
    ).toHaveAttribute("href", target);
    const destination = await openLink(page, source.series ? "TV" : "Movies HD");
    await expect(destination).toHaveURL(target);
  });
}

test("ignores a previous title's delayed response after in-page navigation", async () => {
  library = [existingMovie];
  holdApi("/radarr/");
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect.poll(() => requests.some((item) => item.path === "/radarr/api/v3/movie")).toBe(true);
  library = [existingSeries];
  await page.evaluate((html) => {
    history.pushState({}, "", "/title/tt0903747/");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.replaceChildren(...parsed.head.childNodes);
    document.body.replaceChildren(...parsed.body.childNodes);
  }, seriesPage);
  const tv = page.getByRole("link", { name: "TV", exact: true });
  await expect(tv).toHaveAttribute("href", `${origin}/sonarr/series/breaking-bad`);
  release();
  await expect.poll(() => completed.includes("/radarr/api/v3/movie")).toBe(true);
  await expect(tv).toHaveAttribute("href", `${origin}/sonarr/series/breaking-bad`);
  await expect(page.getByRole("link", { name: "Movies HD", exact: true })).toHaveCount(0);
  await expect(page.locator("#linkarr-panel")).toHaveCount(1);
});

test("reattaches links when the same title heading is replaced", async () => {
  const page = await context.newPage();
  await page.goto(movieUrl);
  await expect(page.locator('h1[data-testid="hero__pageTitle"] > #linkarr-panel')).toBeVisible();
  await page.evaluate(() => {
    const replacement = document.createElement("h1");
    replacement.dataset.testid = "hero__pageTitle";
    replacement.id = "replacement-title";
    replacement.textContent = "Arrival";
    document.querySelector("h1")?.replaceWith(replacement);
  });
  await expect(page.locator("#replacement-title > #linkarr-panel")).toBeVisible();
  await expect(page.locator("#linkarr-panel")).toHaveCount(1);
});

test("waits for a title heading instead of injecting a floating fallback", async () => {
  const page = await context.newPage();
  await page.route(movieUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: moviePage.replace(/<h1[^>]*>.*?<\/h1>/, "") }),
  );
  await page.goto(movieUrl);
  await expect(page.locator("html")).toHaveAttribute("data-public-settings", /Movies HD/);
  await expect(page.locator("#linkarr-panel")).toHaveCount(0);
  await page.evaluate(() => {
    const title = document.createElement("h1");
    title.textContent = "Arrival";
    document.body.append(title);
  });
  await expect(page.locator("h1 > #linkarr-panel")).toBeVisible();
});

test("caches custom icons without refetching while browsing", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const first = page.locator(".instance-card").first();
  await first.locator(".custom-icon summary").click();
  await first.getByLabel("Icon URL", { exact: true }).fill(`${origin}/icon.png`);
  await first.getByRole("button", { name: "Load icon", exact: true }).click();
  await expect(first.getByRole("status")).toContainText("Icon loaded");
  await page.getByRole("button", { name: "Save settings", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Settings saved");
  expect(requests.filter((item) => item.path === "/icon.png")).toHaveLength(1);
  expect(requests.find((item) => item.path === "/icon.png")?.key).toBeUndefined();
  await page.goto(movieUrl);
  await expect(page.locator("#linkarr-panel .icon img")).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/,
  );
  expect(requests.filter((item) => item.path === "/icon.png")).toHaveLength(1);
});

test("saves optional API keys and provides explicit connection diagnostics", async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  const first = page.locator(".instance-card").first();
  await first.getByLabel("Display name").fill("Cinema 1080p");
  await first.getByRole("button", { name: "Test connection" }).click();
  await expect(first.getByRole("status")).toContainText("Connected · Radarr 5.0.0");
  await first.getByLabel("API key (optional)").fill("");
  await first.getByRole("button", { name: "Test connection" }).click();
  await expect(first.getByRole("status")).toContainText("Links work without one");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.locator("#status")).toContainText("Settings saved");
  await page.reload();
  await expect(page.locator(".instance-card").first().getByLabel("Display name")).toHaveValue(
    "Cinema 1080p",
  );
  await expect(page.locator(".instance-card").first().getByLabel("API key (optional)")).toHaveValue(
    "",
  );
});
