import { addDestination, seerrSearchTerm } from "../shared/links";
import { type Media, normalizedTitle } from "../shared/media";
import { type Instance, isRecord } from "../shared/settings";
import { type Fetcher, jsonApi } from "./http";

export async function testSeerrConnection(
  instance: Instance,
  fetcher: Fetcher = fetch,
): Promise<string> {
  if (instance.service !== "seerr") throw new Error("Select a Seerr instance.");
  const status = await jsonApi(instance, "api/v1/status", fetcher);
  if (
    !isRecord(status) ||
    typeof status.version !== "string" ||
    !status.version.trim() ||
    typeof status.commitTag !== "string" ||
    !status.commitTag.trim()
  )
    throw new Error("This URL is not the selected Seerr service.");
  const user = await jsonApi(instance, "api/v1/auth/me", fetcher);
  if (!isRecord(user) || !validId(user.id))
    throw new Error("Seerr did not return an authenticated user. Check the API key.");
  return "Seerr";
}

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export async function findSeerrDestination(
  instance: Instance,
  media: Media,
  fetcher: Fetcher = fetch,
): Promise<URL | null> {
  if (instance.service !== "seerr") throw new Error("Select a Seerr instance.");
  if (!instance.apiKey || media.ids.tmdb) return null;
  const query = new URLSearchParams({ query: seerrSearchTerm(media), page: "1" });
  const response = await jsonApi(instance, `api/v1/search?${query}`, fetcher);
  if (
    !isRecord(response) ||
    response.page !== 1 ||
    typeof response.totalPages !== "number" ||
    !Number.isSafeInteger(response.totalPages) ||
    response.totalPages < 0 ||
    typeof response.totalResults !== "number" ||
    !Number.isSafeInteger(response.totalResults) ||
    response.totalResults < 0 ||
    !Array.isArray(response.results) ||
    response.results.some((item: unknown) => !isRecord(item))
  )
    throw new Error("Unexpected search response. Check that the URL points to Seerr.");
  if (response.totalPages !== 1 || response.totalResults !== response.results.length) return null;
  const identifierSearch = Boolean(media.ids.imdb || (media.kind === "series" && media.ids.tvdb));
  const candidates = (response.results as Record<string, unknown>[]).filter((item) => {
    if (item.mediaType !== (media.kind === "movie" ? "movie" : "tv")) return false;
    if (identifierSearch) return true;
    const title = media.kind === "movie" ? item.title : item.name;
    const date = media.kind === "movie" ? item.releaseDate : item.firstAirDate;
    return (
      Boolean(normalizedTitle(media.title)) &&
      normalizedTitle(title) === normalizedTitle(media.title) &&
      (!media.year ||
        (typeof date === "string" && date.match(/^(\d{4})-/)?.[1] === String(media.year)))
    );
  });
  if (candidates.some((item) => !validId(item.id))) return null;
  const ids = new Set(candidates.map((item) => String(item.id)));
  if (ids.size !== 1) return null;
  const [tmdb] = ids;
  if (!tmdb) return null;
  return addDestination(instance, { ...media, ids: { ...media.ids, tmdb } });
}
