import { isRecord } from "./settings";

export interface Media {
  kind: "movie" | "series";
  title: string;
  year?: number;
  ids: { imdb?: string; tmdb?: string; tvdb?: string };
}

export function parseMedia(value: unknown): Media {
  if (
    !isRecord(value) ||
    (value.kind !== "movie" && value.kind !== "series") ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 300 ||
    !isRecord(value.ids)
  ) {
    throw new Error("This page does not contain a supported movie or TV series.");
  }
  const ids: Media["ids"] = {};
  for (const key of ["imdb", "tmdb", "tvdb"] as const) {
    const id = value.ids[key];
    if (id === undefined) continue;
    if (typeof id !== "string" || !(key === "imdb" ? /^tt\d{5,12}$/ : /^[1-9]\d{0,11}$/).test(id)) {
      throw new Error("Invalid media identifier.");
    }
    ids[key] = id;
  }
  const media: Media = { kind: value.kind, title: value.title.trim(), ids };
  if (value.year !== undefined) {
    if (
      typeof value.year !== "number" ||
      !Number.isInteger(value.year) ||
      value.year < 1800 ||
      value.year > 2200
    ) {
      throw new Error("Invalid release year.");
    }
    media.year = value.year;
  }
  return media;
}

export function supportedPage(url: URL): boolean {
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  return (
    url.protocol === "https:" &&
    ["imdb.com", "themoviedb.org", "thetvdb.com", "mdblist.com"].includes(host)
  );
}
