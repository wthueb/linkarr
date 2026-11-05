import type { Media } from "../shared/media";
import { type Instance, isRecord } from "../shared/settings";

export type Fetcher = typeof fetch;
export type ArrItem = Record<string, unknown>;

export function instanceUrl(instance: Instance, path: string): URL {
  return new URL(`${instance.baseUrl}/${path}`);
}

export async function api(
  instance: Instance,
  path: string,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  if (!instance.apiKey) throw new Error(`${instance.name}: configure an API key to use the API.`);
  let response: Response;
  try {
    response = await fetcher(instanceUrl(instance, `api/v3/${path}`), {
      headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      `${instance.name}: connection failed. Check the URL, host permission, TLS certificate, and network access. Redirects are not followed.`,
    );
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error(
        `${instance.name}: access denied. Check the API key and any reverse-proxy authentication.`,
      );
    throw new Error(`${instance.name}: API returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(
      `${instance.name}: expected JSON from the API. Check the instance URL and proxy configuration.`,
    );
  }
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

function normalizedTitle(value: unknown): string {
  return typeof value === "string"
    ? value
        .normalize("NFKC")
        .toLocaleLowerCase("en-US")
        .replace(/[^\p{L}\p{N}]/gu, "")
    : "";
}

export async function findExistingDestination(
  instance: Instance,
  input: Media,
  fetcher: Fetcher = fetch,
): Promise<URL | null> {
  if ((instance.service === "radarr") !== (input.kind === "movie"))
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
