import { describe, expect, it, vi } from "vitest";
import { api, findExistingDestination } from "../../src/background/arr";
import type { Media } from "../../src/shared/media";
import { instance } from "./support";

const movie: Media = { kind: "movie", title: "Arrival", ids: { tmdb: "329865" }, year: 2016 };
const series: Media = { kind: "series", title: "Breaking Bad", ids: { tvdb: "81189" } };
const sonarr = {
  ...instance,
  id: "sonarr",
  service: "sonarr" as const,
  baseUrl: "https://arr.example.test/sonarr",
};
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });

describe("background library checks", () => {
  it("resolves an existing movie, preserving reverse-proxy paths", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json([{ tmdbId: 329865, titleSlug: "arrival-329865" }]));
    expect((await findExistingDestination(instance, movie, fetcher))?.href).toBe(
      "https://arr.example.test/radarr/movie/arrival-329865",
    );
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "https://arr.example.test/radarr/api/v3/movie?tmdbId=329865",
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-Api-Key": instance.apiKey },
      credentials: "omit",
      redirect: "error",
    });
  });
  it("resolves an existing series", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json([{ tvdbId: 81189, titleSlug: "breaking-bad" }]));
    expect((await findExistingDestination(sonarr, series, fetcher))?.href).toBe(
      "https://arr.example.test/sonarr/series/breaking-bad",
    );
  });
  it("does not contact an API without a key", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      findExistingDestination({ ...instance, apiKey: "" }, movie, fetcher),
    ).resolves.toBeNull();
    await expect(api({ ...instance, apiKey: "" }, "movie", fetcher)).rejects.toThrow(/API key/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([instance, { ...instance, id: "second", baseUrl: "http://local.test:7878/4k" }])(
    "leaves absent titles on their initial links for each instance",
    async (current) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([]));
      await expect(findExistingDestination(current, movie, fetcher)).resolves.toBeNull();
      expect(String(fetcher.mock.calls[0]?.[0])).toBe(
        `${current.baseUrl}/api/v3/movie?tmdbId=329865`,
      );
    },
  );
  it("matches IMDb identifiers without assuming equal titles", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json([{ imdbId: "tt0903747", titleSlug: "breaking-bad" }]));
    expect(
      (await findExistingDestination(sonarr, { ...series, ids: { imdb: "tt0903747" } }, fetcher))
        ?.pathname,
    ).toBe("/sonarr/series/breaking-bad");
  });
  it("keeps the original IMDb link for an absent show", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json([]));
    await expect(
      findExistingDestination(sonarr, { ...series, ids: { imdb: "tt0903747" } }, fetcher),
    ).resolves.toBeNull();
  });
  it("resolves TMDB series through an unambiguous title/year lookup", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json([{ title: "Breaking Bad", year: 2008, tvdbId: 81189 }]))
      .mockResolvedValueOnce(json([{ tvdbId: 81189, titleSlug: "breaking-bad" }]));
    const result = await findExistingDestination(
      sonarr,
      { ...series, year: 2008, ids: { tmdb: "1396" } },
      fetcher,
    );
    expect(result?.pathname).toBe("/sonarr/series/breaking-bad");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("series?tvdbId=81189");
  });
  it("leaves ambiguous titles on their add/search links", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json([
        { title: "Ghosts", tvdbId: 1 },
        { title: "Ghosts", tvdbId: 2 },
      ]),
    );
    await expect(
      findExistingDestination(sonarr, { ...series, title: "Ghosts", ids: {} }, fetcher),
    ).resolves.toBeNull();
  });
  it("does not match a conflicting primary ID just because IMDb matches", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json([{ tmdbId: 1, imdbId: "tt2543164", titleSlug: "wrong" }]));
    await expect(
      findExistingDestination(
        instance,
        { ...movie, ids: { ...movie.ids, imdb: "tt2543164" } },
        fetcher,
      ),
    ).resolves.toBeNull();
  });
  it("rejects type mismatches and unsafe detail-page slugs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json([{ tmdbId: 329865, titleSlug: "../../elsewhere" }]));
    await expect(findExistingDestination(instance, movie, fetcher)).rejects.toThrow(/slug/);
    await expect(findExistingDestination(instance, series, fetcher)).rejects.toThrow(/media type/);
  });
  it.each([401, 403, 404, 500])(
    "reports HTTP %s to the background handler so it can retain the initial link",
    async (status) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("failure", { status }));
      await expect(findExistingDestination(instance, movie, fetcher)).rejects.toThrow();
    },
  );
  it("does not leak API keys through network or response errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(instance.apiKey));
    await expect(api(instance, "movie", fetcher)).rejects.toThrow(/connection failed/);
    fetcher.mockResolvedValue(new Response("<html>Login</html>"));
    await expect(findExistingDestination(instance, movie, fetcher)).rejects.toThrow(
      /expected JSON/,
    );
    fetcher.mockResolvedValue(json({ login: true }));
    await expect(findExistingDestination(instance, movie, fetcher)).rejects.toThrow(
      /Unexpected library/,
    );
  });
});
