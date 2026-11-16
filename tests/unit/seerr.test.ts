import { describe, expect, it, vi } from "vitest";
import { findSeerrDestination, testSeerrConnection } from "../../src/background/seerr";
import type { Media } from "../../src/shared/media";
import { instance, seerr } from "./support";

const movie: Media = { kind: "movie", title: "Arrival", year: 2016, ids: { imdb: "tt2543164" } };
const series: Media = { kind: "series", title: "Breaking Bad", ids: { tvdb: "81189" } };
const movieResult = { id: 329865, mediaType: "movie", title: "Arrival", releaseDate: "2016-11-10" };
const tvResult = { id: 1396, mediaType: "tv", name: "Breaking Bad", firstAirDate: "2008-01-20" };
const json = (value: unknown) => new Response(JSON.stringify(value));
const results = (items: unknown[], extra = {}) =>
  json({ page: 1, totalPages: 1, totalResults: items.length, results: items, ...extra });

function fetchResults(items: unknown[], extra = {}) {
  return vi.fn<typeof fetch>().mockImplementation(async () => results(items, extra));
}

describe("Seerr title resolution", () => {
  it("resolves IMDb movies without requiring an existing library entry", async () => {
    const fetcher = fetchResults([movieResult, { id: 50, mediaType: "person" }, tvResult]);
    expect((await findSeerrDestination(seerr, movie, fetcher))?.href).toBe(
      `${seerr.baseUrl}/movie/329865`,
    );
    const [url, options] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${seerr.baseUrl}/api/v1/search?query=imdb%3Att2543164&page=1`);
    expect(options).toMatchObject({
      headers: { "X-Api-Key": seerr.apiKey, Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(String(url)).not.toContain(seerr.apiKey);
    expect(options?.method).toBeUndefined();
  });

  it("resolves TVDB series to TMDB TV pages and prefers IMDb when both exist", async () => {
    const fetcher = fetchResults([movieResult, tvResult]);
    expect((await findSeerrDestination(seerr, series, fetcher))?.href).toBe(
      `${seerr.baseUrl}/tv/1396`,
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("query=tvdb%3A81189");
    await findSeerrDestination(
      seerr,
      { ...series, ids: { ...series.ids, imdb: "tt0903747" } },
      fetcher,
    );
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("query=imdb%3Att0903747");
  });

  it("does not contact Seerr without a key or when a TMDB link is already known", async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(await findSeerrDestination({ ...seerr, apiKey: "" }, movie, fetcher)).toBeNull();
    expect(
      await findSeerrDestination(seerr, { ...movie, ids: { tmdb: "329865" } }, fetcher),
    ).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires an exact normalized title and the supplied release year", async () => {
    const fetcher = fetchResults([
      { ...movieResult, id: 1, releaseDate: "1996-01-01" },
      { ...movieResult, title: "Ａrrival!" },
      { ...movieResult, id: 2, title: "The Arrival" },
      tvResult,
    ]);
    expect((await findSeerrDestination(seerr, { ...movie, ids: {} }, fetcher))?.pathname).toBe(
      "/requests/movie/329865",
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("query=Arrival");
  });

  it("matches TV names and first-air years for title-only sources", async () => {
    const fetcher = fetchResults([
      { ...tvResult, id: 1, firstAirDate: "2020-01-01" },
      tvResult,
      { ...movieResult, title: "Breaking Bad" },
    ]);
    expect(
      (await findSeerrDestination(seerr, { ...series, year: 2008, ids: {} }, fetcher))?.pathname,
    ).toBe("/requests/tv/1396");
  });

  it("allows a unique exact title when no source year is available", async () => {
    const fetcher = fetchResults([{ ...tvResult, firstAirDate: "" }]);
    expect((await findSeerrDestination(seerr, { ...series, ids: {} }, fetcher))?.pathname).toBe(
      "/requests/tv/1396",
    );
  });

  it.each([movie, { ...movie, ids: {} }])(
    "rejects ambiguity without a weaker retry: %j",
    async (media) => {
      const fetcher = fetchResults([movieResult, { ...movieResult, id: 999 }]);
      expect(await findSeerrDestination(seerr, media, fetcher)).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("deduplicates equal TMDB IDs and ignores response navigation URLs", async () => {
    const fetcher = fetchResults([
      { ...movieResult, href: "https://evil.test/" },
      { ...movieResult, mediaInfo: { status: 5 } },
    ]);
    expect((await findSeerrDestination(seerr, movie, fetcher))?.href).toBe(
      `${seerr.baseUrl}/movie/329865`,
    );
  });

  it.each([undefined, null, "329865", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, "../../evil"])(
    "retains the fallback for invalid candidate ID %s",
    async (id) => {
      expect(
        await findSeerrDestination(seerr, movie, fetchResults([{ ...movieResult, id }])),
      ).toBeNull();
    },
  );

  it.each([
    { items: [] },
    { items: [tvResult] },
    { items: [{ ...movieResult, title: "Another title" }] },
    { items: [{ ...movieResult, releaseDate: "" }] },
  ])("retains title searches when no exact match exists: %j", async ({ items }) => {
    expect(
      await findSeerrDestination(seerr, { ...movie, ids: {} }, fetchResults(items)),
    ).toBeNull();
  });

  it.each([{ totalPages: 2 }, { totalPages: 0 }, { totalResults: 10 }, { page: 2 }])(
    "does not infer uniqueness from incomplete results: %j",
    async (extra) => {
      const resolve = findSeerrDestination(
        seerr,
        { ...movie, ids: {} },
        fetchResults([movieResult], extra),
      );
      if ("page" in extra) await expect(resolve).rejects.toThrow(/Unexpected search/);
      else expect(await resolve).toBeNull();
    },
  );

  it.each([
    null,
    [],
    {},
    { results: [] },
    { page: 1, totalPages: -1, totalResults: 1, results: [movieResult] },
    { page: 1, totalPages: 1, totalResults: 1, results: [null] },
  ])("rejects malformed search responses: %j", async (value) => {
    await expect(
      findSeerrDestination(seerr, movie, vi.fn<typeof fetch>().mockResolvedValue(json(value))),
    ).rejects.toThrow(/Unexpected search/);
  });

  it.each([401, 403, 404, 500])("reports HTTP %s without leaking keys", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(seerr.apiKey, { status }));
    await expect(findSeerrDestination(seerr, movie, fetcher)).rejects.not.toThrow(seerr.apiKey);
  });

  it.each([
    new Error("network"),
    new DOMException("timeout", "TimeoutError"),
    new TypeError("redirect"),
  ])("sanitizes network, timeout, and redirect failures: %s", async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
    await expect(findSeerrDestination(seerr, movie, fetcher)).rejects.toThrow(/connection failed/);
  });

  it("uses a 12-second abort signal and sanitizes JSON/network errors", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Login</html>"));
    try {
      await expect(findSeerrDestination(seerr, movie, fetcher)).rejects.toThrow(/expected JSON/);
      expect(timeout).toHaveBeenCalledWith(12000);
      fetcher.mockRejectedValue(new Error(seerr.apiKey));
      await expect(findSeerrDestination(seerr, movie, fetcher)).rejects.not.toThrow(seerr.apiKey);
    } finally {
      timeout.mockRestore();
    }
  });

  it("rejects Arr instances without contacting their APIs", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(findSeerrDestination(instance, movie, fetcher)).rejects.toThrow(/Seerr instance/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Seerr connection testing", () => {
  const status = { version: "3.0.0", commitTag: "local" };

  it("uses documented endpoints when the API root returns 404, preserving base paths", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url) === `${seerr.baseUrl}/api/v1/status`) return json(status);
      if (String(url) === `${seerr.baseUrl}/api/v1/auth/me`)
        return json({ id: 1, displayName: "Test user" });
      return new Response("Not Found", { status: 404 });
    });
    expect(await testSeerrConnection(seerr, fetcher)).toBe("Seerr");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
      `${seerr.baseUrl}/api/v1/status`,
      `${seerr.baseUrl}/api/v1/auth/me`,
    ]);
  });

  it("rejects wrong services before testing authentication", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ appName: "Radarr", version: "5" }));
    await expect(testSeerrConnection(seerr, fetcher)).rejects.toThrow(/not the selected Seerr/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(testSeerrConnection(instance, fetcher)).rejects.toThrow(/Seerr instance/);
  });

  it.each([
    null,
    {},
    { version: "3.0.0" },
    { version: "", commitTag: "local" },
    { version: "3.0.0", commitTag: "" },
  ])("rejects invalid Seerr status responses before testing authentication: %j", async (value) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(value));
    await expect(testSeerrConnection(seerr, fetcher)).rejects.toThrow(/not the selected Seerr/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { id: 0 }, { id: "1" }, null])(
    "rejects unauthenticated responses: %j",
    async (user) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json(status))
        .mockResolvedValueOnce(json(user));
      await expect(testSeerrConnection(seerr, fetcher)).rejects.toThrow(/authenticated user/);
    },
  );

  it("does not accept a public status response as proof of a valid key", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(status))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(testSeerrConnection(seerr, fetcher)).rejects.toThrow(/access denied/);
  });

  it("requires a key before making requests", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(testSeerrConnection({ ...seerr, apiKey: "" }, fetcher)).rejects.toThrow(/API key/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
