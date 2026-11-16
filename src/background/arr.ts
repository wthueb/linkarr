import { type Media, normalizedTitle } from "../shared/media";
import { supportsMedia } from "../shared/services";
import { type Instance, isRecord } from "../shared/settings";
import { type Fetcher, instanceUrl, jsonApi } from "./http";

export type ArrItem = Record<string, unknown>;

export async function api(
  instance: Instance,
  path: string,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  if (instance.service === "seerr") throw new Error("Use the Seerr API for this instance.");
  return jsonApi(instance, `api/v3/${path}`, fetcher);
}

function items(value: unknown): ArrItem[] {
  if (!Array.isArray(value) || value.some((item: unknown) => !isRecord(item))) {
    throw new Error("Unexpected library response. Check that the URL points to Radarr or Sonarr.");
  }
  return value as ArrItem[];
}

function numericId(value: unknown): string | undefined {
  return (typeof value === "number" || typeof value === "string") &&
    /^[1-9]\d*$/.test(String(value))
    ? String(value)
    : undefined;
}

function matchId(item: ArrItem, media: Media, service: Instance["service"]): boolean {
  const primary = service === "radarr" ? "tmdb" : "tvdb";
  if (media.ids[primary] && numericId(item[`${primary}Id`]))
    return media.ids[primary] === String(item[`${primary}Id`]);
  return Boolean(media.ids.imdb && item.imdbId === media.ids.imdb);
}

export async function findExistingDestination(
  instance: Instance,
  input: Media,
  fetcher: Fetcher = fetch,
): Promise<URL | null> {
  if (instance.service === "seerr" || !supportsMedia(instance.service, input.kind))
    throw new Error("This instance does not handle this media type.");
  if (!instance.apiKey) return null;
  let media: Media = { ...input, ids: { ...input.ids } };
  const endpoint = instance.service === "radarr" ? "movie" : "series";
  const primary = instance.service === "radarr" ? "tmdb" : "tvdb";
  if (!media.ids[primary] && !media.ids.imdb) {
    const results = items(
      await api(instance, `${endpoint}/lookup?term=${encodeURIComponent(media.title)}`, fetcher),
    );
    const candidates = results.filter(
      (item) =>
        normalizedTitle(item.title) === normalizedTitle(media.title) &&
        (!media.year || item.year === media.year),
    );
    if (candidates.length === 1) {
      const id = numericId(candidates[0]?.[`${primary}Id`]);
      if (id) media = { ...media, ids: { ...media.ids, [primary]: id } };
    }
    if (!media.ids[primary]) return null;
  }
  const query = media.ids[primary] ? `?${primary}Id=${media.ids[primary]}` : "";
  const library = items(await api(instance, `${endpoint}${query}`, fetcher));
  const existing = library.find((item) => matchId(item, media, instance.service));
  if (existing) {
    const slug = typeof existing.titleSlug === "string" ? existing.titleSlug : "";
    if (!slug || /[/?#\\]/.test(slug))
      throw new Error(`${instance.name}: the existing title has no valid detail-page slug.`);
    return instanceUrl(instance, `${endpoint}/${encodeURIComponent(slug)}`);
  }
  return null;
}
