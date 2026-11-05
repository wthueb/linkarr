import { type Media, supportedPage } from "../shared/media";
import { isRecord } from "../shared/settings";
import { findTitleElement } from "./placement";

function metadata(doc: Document, property: string): string {
  return doc.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)?.content ?? "";
}

function structuredItems(doc: Document): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  function visit(value: unknown): void {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isRecord(value)) {
      items.push(value);
      if (value["@graph"]) visit(value["@graph"]);
      if (value.mainEntity) visit(value.mainEntity);
    }
  }
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(script.textContent ?? ""));
    } catch {}
  }
  return items;
}

function schemaType(item: Record<string, unknown>): string[] {
  return (Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]]).filter(
    (v): v is string => typeof v === "string",
  );
}

function addExternalIds(media: Media, urls: string[]): void {
  for (const href of urls) {
    let url: URL;
    try {
      url = new URL(href);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/^www\./, "");
    const imdb = host === "imdb.com" ? url.pathname.match(/^\/title\/(tt\d+)/) : null;
    if (imdb?.[1] && !media.ids.imdb) media.ids.imdb = imdb[1];
    const tmdb = host === "themoviedb.org" ? url.pathname.match(/^\/(movie|tv)\/(\d+)/) : null;
    if (tmdb?.[2] && tmdb[1] === (media.kind === "movie" ? "movie" : "tv") && !media.ids.tmdb)
      media.ids.tmdb = tmdb[2];
    const tvdb =
      host === "thetvdb.com" &&
      url.searchParams.get("tab") === "series" &&
      url.searchParams.get("id");
    if (tvdb && /^\d+$/.test(tvdb) && !media.ids.tvdb) media.ids.tvdb = tvdb;
  }
}

export function detectMedia(doc: Document, href: string): Media | null {
  const url = new URL(href);
  if (!supportedPage(url)) return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const path = url.pathname;
  const schemas = structuredItems(doc);
  const schema = schemas.find((item) =>
    schemaType(item).some((t) => ["Movie", "TVSeries", "TVMiniSeries", "TVEpisode"].includes(t)),
  );
  const types = schema ? schemaType(schema) : [];
  let kind: Media["kind"];
  const ids: Media["ids"] = {};
  if (host === "imdb.com") {
    const id = path.match(/^\/title\/(tt\d{5,12})\/?$/)?.[1];
    if (!id || types.includes("TVEpisode")) return null;
    const canonical = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
    const canonicalId = canonical?.match(/\/title\/(tt\d+)/)?.[1];
    const schemaId =
      typeof schema?.url === "string" ? schema.url.match(/\/title\/(tt\d+)/)?.[1] : undefined;
    if ((canonicalId && canonicalId !== id) || (schemaId && schemaId !== id)) return null;
    ids.imdb = id;
    if (types.includes("Movie")) kind = "movie";
    else if (types.includes("TVSeries") || types.includes("TVMiniSeries")) kind = "series";
    else if (metadata(doc, "og:type") === "video.movie") kind = "movie";
    else if (["video.tv_show", "tv_show"].includes(metadata(doc, "og:type"))) kind = "series";
    else return null;
  } else if (host === "themoviedb.org") {
    const match = path.match(/^\/(movie|tv)\/(\d+)(?:-[^/]*)?\/?$/);
    if (!match?.[2]) return null;
    kind = match[1] === "movie" ? "movie" : "series";
    ids.tmdb = match[2];
  } else if (host === "thetvdb.com") {
    const match = path.match(/^\/(movies?|series)\/[^/]+\/?$/);
    if (!match) return null;
    kind = match[1] === "series" ? "series" : "movie";
    if (kind === "series") {
      for (const item of doc.querySelectorAll("#series_basic_info li")) {
        const label = item.querySelector("strong")?.textContent ?? "";
        if (/(?:thetvdb\.com\s+)?series\s+id/i.test(label)) {
          const id = item.querySelector("span")?.textContent?.trim();
          if (id && /^\d+$/.test(id)) ids.tvdb = id;
        }
      }
    }
  } else {
    const match = path.match(/^\/(movie|show|tv)\/[^/]+\/?$/);
    if (!match) return null;
    kind = match[1] === "movie" ? "movie" : "series";
    const imdb = path.match(/\/(tt\d{5,12})\/?$/)?.[1];
    if (imdb) ids.imdb = imdb;
  }
  if (
    types.includes("TVEpisode") ||
    (kind === "series" && types.includes("Movie")) ||
    (kind === "movie" && types.some((type) => ["TVSeries", "TVMiniSeries"].includes(type)))
  )
    return null;
  const heading = findTitleElement(doc, href)?.textContent?.trim();
  const rawTitle =
    typeof schema?.name === "string" ? schema.name : heading || metadata(doc, "og:title");
  const title = rawTitle.replace(/\s*\(\d{4}\).*$/, "").trim();
  if (!title) return null;
  const media: Media = { kind, title, ids };
  const date =
    typeof schema?.datePublished === "string"
      ? schema.datePublished
      : rawTitle.match(/\((\d{4})\)/)?.[1];
  const year = date?.match(/^(\d{4})/)?.[1];
  if (year) media.year = Number(year);
  const external: string[] = [];
  const sameAs: unknown[] = Array.isArray(schema?.sameAs) ? schema.sameAs : [schema?.sameAs];
  external.push(...sameAs.filter((v): v is string => typeof v === "string"));
  if (typeof schema?.url === "string") external.push(schema.url);
  const selectors =
    host === "themoviedb.org"
      ? ".social_links a[href]"
      : host === "thetvdb.com"
        ? "#series_basic_info a[href]"
        : "main a[data-source][href], .external-links a[href], .ratings a[href], .movie-page .movie-hero__scorecard .movie-ratings-list a.movie-rating-row[href]";
  for (const link of doc.querySelectorAll<HTMLAnchorElement>(selectors)) external.push(link.href);
  addExternalIds(media, external);
  return media;
}
