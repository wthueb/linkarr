import { describe, expect, it } from "vitest";
import { addDestination, pageLinks } from "../../src/shared/links";
import type { Media } from "../../src/shared/media";
import { instance } from "./support";

const movie: Media = {
  kind: "movie",
  title: "Arrival",
  ids: { tmdb: "329865", imdb: "tt2543164" },
};
const sonarr = { ...instance, service: "sonarr" as const };

describe("immediate navigation URLs", () => {
  it("builds movie links without an API key, preserving base paths", () => {
    const withoutKey = { ...instance, apiKey: "" };
    expect(addDestination(withoutKey, movie).href).toBe(
      `${instance.baseUrl}/add/new?term=tmdb%3A329865`,
    );
  });
  it("prefers TVDB IDs for Sonarr, then IMDb, then the title", () => {
    const series: Media = {
      kind: "series",
      title: "Breaking Bad",
      ids: { tvdb: "81189", imdb: "tt0903747" },
    };
    expect(addDestination(sonarr, series).searchParams.get("term")).toBe("tvdb:81189");
    expect(
      addDestination(sonarr, { ...series, ids: { imdb: "tt0903747" } }).searchParams.get("term"),
    ).toBe("imdb:tt0903747");
    expect(
      addDestination(sonarr, { ...series, ids: { tmdb: "1396" } }).searchParams.get("term"),
    ).toBe("Breaking Bad");
  });
  it("escapes search text and rejects mismatched media types", () => {
    expect(
      addDestination(instance, { ...movie, title: "A & B / C?", ids: {} }).searchParams.get("term"),
    ).toBe("A & B / C?");
    expect(() => addDestination(sonarr, movie)).toThrow(/media type/);
  });
  it("exposes only navigation URLs and whether a lookup is possible, never credentials", () => {
    const links = pageLinks(
      {
        version: 1,
        enabled: true,
        instances: [
          instance,
          { ...instance, id: "no-api", apiKey: "" },
          { ...sonarr, id: "tv" },
          { ...instance, id: "disabled", enabled: false },
        ],
      },
      movie,
    );
    expect(links.instances).toHaveLength(2);
    expect(links.instances.map((item) => item.checkLibrary)).toEqual([true, false]);
    expect(links.instances[0]?.href).toBe(addDestination(instance, movie).href);
    const serialized = JSON.stringify(links);
    expect(serialized).not.toContain(instance.apiKey);
    expect(serialized).not.toMatch(/"(apiKey|baseUrl|iconUrl)"/);
  });
  it("does not expose links when the extension is disabled", () => {
    expect(
      pageLinks({ version: 1, enabled: false, instances: [instance] }, movie).instances,
    ).toEqual([]);
  });
});
