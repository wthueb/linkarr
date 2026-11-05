import { describe, expect, it } from "vitest";
import { detectMedia } from "../../src/content/detect";
import { findTitleElement } from "../../src/content/placement";
import { page } from "./support";

const cases = [
  {
    name: "IMDb hero title",
    url: "https://www.imdb.com/title/tt2543164/",
    markup:
      '<h1>Other heading</h1><h1 data-testid="hero__pageTitle" id="target"><span>Arrival</span></h1>',
  },
  {
    name: "TMDB header title",
    url: "https://www.themoviedb.org/movie/329865-arrival",
    markup:
      '<h1>TMDB</h1><section class="header"><div class="title"><h2 id="target"><a>Arrival</a><span> (2016)</span></h2></div></section>',
  },
  {
    name: "TVDB series title",
    url: "https://thetvdb.com/series/breaking-bad",
    markup: '<h1>TVDB</h1><h2 id="series_title">Breaking Bad</h2>',
    target: "series_title",
  },
  {
    name: "MDBList main title",
    url: "https://mdblist.com/movie/abc-arrival",
    markup: '<header><h1>MDBList</h1></header><main><h1 id="target">Arrival</h1></main>',
  },
];

describe("site-specific title placement", () => {
  it.each(cases)("prefers the $name over unrelated headings", ({ url, markup, target }) => {
    const doc = page(markup);
    expect(findTitleElement(doc, url)?.id).toBe(target ?? "target");
  });
  it("detects TMDB titles from the same header used for placement", () => {
    const source = cases[1];
    if (!source) throw new Error("Missing TMDB fixture.");
    expect(detectMedia(page(source.markup), source.url)).toEqual({
      kind: "movie",
      title: "Arrival",
      year: 2016,
      ids: { tmdb: "329865" },
    });
  });
  it("returns no anchor until a title heading appears", () => {
    expect(findTitleElement(page("<main>Loading</main>"), cases[0]?.url ?? "")).toBeNull();
  });
  it("does not target headings on unrelated sites", () => {
    expect(findTitleElement(page("<h1>Arrival</h1>"), "https://example.test/")).toBeNull();
  });
});
