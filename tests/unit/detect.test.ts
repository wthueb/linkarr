import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectMedia } from "../../src/content/detect";
import { page } from "./support";

const mdblistVerity = readFileSync("tests/fixtures/mdblist-verity.html", "utf8");
const schema = (type: string, name = "Arrival", extra = "") =>
  `<script type="application/ld+json">{"@type":"${type}","name":"${name}","datePublished":"2016-09-01"${extra}}</script>`;

describe("content-page adapters", () => {
  it("waits for matching canonical metadata during in-page navigation", () => {
    const doc = page(
      `${schema("Movie")}<link rel="canonical" href="https://www.imdb.com/title/tt2543164/">`,
    );
    expect(detectMedia(doc, "https://www.imdb.com/title/tt0903747/")).toBeNull();
  });
  it("detects IMDb movies from structured data", () => {
    expect(detectMedia(page(schema("Movie")), "https://www.imdb.com/title/tt2543164/")).toEqual({
      kind: "movie",
      title: "Arrival",
      year: 2016,
      ids: { imdb: "tt2543164" },
    });
  });
  it.each(["TVSeries", "TVMiniSeries"])("detects IMDb %s", (type) => {
    expect(detectMedia(page(schema(type)), "https://www.imdb.com/title/tt0903747/")?.kind).toBe(
      "series",
    );
  });
  it("does not treat an IMDb episode as a series or guess unknown types", () => {
    expect(
      detectMedia(page(schema("TVEpisode")), "https://www.imdb.com/title/tt1234567/"),
    ).toBeNull();
    expect(
      detectMedia(page("<h1>Unknown</h1>"), "https://www.imdb.com/title/tt1234567/"),
    ).toBeNull();
  });
  it("supports JSON-LD graphs and malformed unrelated scripts", () => {
    const doc = page(
      '<script type="application/ld+json">bad</script><script type="application/ld+json">{"@graph":[{"@type":["Thing","Movie"],"name":"Arrival"}]}</script>',
    );
    expect(detectMedia(doc, "https://www.imdb.com/title/tt2543164/")?.title).toBe("Arrival");
  });
  it("uses IMDb OpenGraph metadata when structured data is absent", () => {
    expect(
      detectMedia(
        page('<meta property="og:type" content="video.tv_show"><h1>Breaking Bad</h1>'),
        "https://imdb.com/title/tt0903747/",
      )?.kind,
    ).toBe("series");
  });
  it.each([
    ["movie", "329865-arrival", "movie"],
    ["tv", "1396-breaking-bad", "series"],
  ])("detects TMDB %s pages", (path, id, kind) => {
    const media = detectMedia(
      page("<h1>Arrival (2016)</h1>"),
      `https://www.themoviedb.org/${path}/${id}?language=en`,
    );
    expect(media?.kind).toBe(kind);
    expect(media?.ids.tmdb).toBe(id?.split("-")[0]);
    expect(media?.title).toBe("Arrival");
  });
  it("reads TMDB external links but ignores recommendations", () => {
    const doc = page(
      '<h1>Breaking Bad</h1><div class="social_links"><a href="https://www.imdb.com/title/tt0903747/">IMDb</a></div><aside><a href="https://www.imdb.com/title/tt9999999/">Recommendation</a></aside>',
    );
    expect(detectMedia(doc, "https://themoviedb.org/tv/1396-breaking-bad")?.ids.imdb).toBe(
      "tt0903747",
    );
  });
  it("extracts TVDB IDs by label, not list position", () => {
    const doc = page(
      '<h1 id="series_title">Breaking Bad</h1><div id="series_basic_info"><ul><li><strong>Network</strong><span>AMC</span></li><li><strong>TheTVDB.com Series ID</strong><span>81189</span></li></ul></div>',
    );
    expect(detectMedia(doc, "https://thetvdb.com/series/breaking-bad")).toEqual({
      kind: "series",
      title: "Breaking Bad",
      ids: { tvdb: "81189" },
    });
  });
  it("uses title lookup for TVDB movies", () => {
    expect(
      detectMedia(page("<h1>Arrival (2016)</h1>"), "https://thetvdb.com/movies/arrival")?.kind,
    ).toBe("movie");
  });
  it.each([
    ["movie", "movie"],
    ["show", "series"],
  ])("supports MDBList %s slug pages", (path, kind) => {
    expect(
      detectMedia(
        page("<h1>Breaking Bad (2008)</h1>"),
        `https://mdblist.com/${path}/8plj-breaking-bad`,
      ),
    ).toMatchObject({ kind, title: "Breaking Bad", year: 2008 });
  });
  it("reads Verity's native IDs from MDBList's live scorecard layout without JSON-LD", () => {
    const doc = page(mdblistVerity);
    expect(detectMedia(doc, "https://mdblist.com/movie/3fsqj-verity")).toEqual({
      kind: "movie",
      title: "Verity",
      year: 2026,
      ids: { imdb: "tt32261958", tmdb: "1283515" },
    });
  });
  it("ignores rating links outside the current title's scorecard", () => {
    const doc = page(mdblistVerity);
    const recommendation = doc.createElement("aside");
    recommendation.className = "movie-ratings-list";
    recommendation.innerHTML =
      '<a class="movie-rating-row" href="https://www.themoviedb.org/movie/999">Other title</a><a class="movie-rating-row" href="https://www.imdb.com/title/tt9999999">Other IMDb</a>';
    doc.querySelector(".movie-page")?.prepend(recommendation);
    expect(detectMedia(doc, "https://mdblist.com/movie/3fsqj-verity")?.ids).toEqual({
      imdb: "tt32261958",
      tmdb: "1283515",
    });
  });
  it("reads scoped structured external IDs on MDBList", () => {
    expect(
      detectMedia(
        page(schema("Movie", "Arrival", ',"sameAs":["https://www.imdb.com/title/tt2543164/"]')),
        "https://mdblist.com/movie/abc-arrival",
      )?.ids.imdb,
    ).toBe("tt2543164");
  });
  it.each([
    "https://www.imdb.com/search/title/",
    "https://www.imdb.com/title/tt2543164/reviews",
    "https://themoviedb.org/tv/1396/season/1",
    "https://thetvdb.com/series/breaking-bad/seasons/official/1",
    "https://mdblist.com/lists/user/movies",
    "https://imdb.com.evil.test/title/tt2543164/",
  ])("ignores unsupported page %s", (url) => {
    expect(detectMedia(page(schema("Movie")), url)).toBeNull();
  });
});
