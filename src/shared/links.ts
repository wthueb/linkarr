import type { Media } from "./media";
import { supportsMedia } from "./services";
import { type Instance, type PublicInstance, publicSettings, type Settings } from "./settings";

export interface MediaLink extends PublicInstance {
  href: string;
  checkLibrary: boolean;
}

export interface PageLinks {
  enabled: boolean;
  instances: MediaLink[];
}

export function seerrSearchTerm(media: Media): string {
  if (media.ids.imdb) return `imdb:${media.ids.imdb}`;
  if (media.kind === "series" && media.ids.tvdb) return `tvdb:${media.ids.tvdb}`;
  return media.title;
}

export function addDestination(instance: Pick<Instance, "baseUrl" | "service">, media: Media): URL {
  if (!supportsMedia(instance.service, media.kind)) {
    throw new Error("This instance does not handle this media type.");
  }
  if (instance.service === "seerr") {
    if (media.ids.tmdb)
      return new URL(
        `${instance.baseUrl}/${media.kind === "movie" ? "movie" : "tv"}/${media.ids.tmdb}`,
      );
    const destination = new URL(`${instance.baseUrl}/search`);
    destination.searchParams.set("query", seerrSearchTerm(media));
    return destination;
  }
  const primary = instance.service === "radarr" ? "tmdb" : "tvdb";
  const term = media.ids[primary]
    ? `${primary}:${media.ids[primary]}`
    : media.ids.imdb
      ? `imdb:${media.ids.imdb}`
      : media.title;
  const destination = new URL(`${instance.baseUrl}/add/new`);
  destination.searchParams.set("term", term);
  return destination;
}

export function pageLinks(settings: Settings, media: Media): PageLinks {
  const publicInstances = publicSettings(settings).instances;
  return {
    enabled: settings.enabled,
    instances: settings.enabled
      ? settings.instances.flatMap((instance, index) => {
          const visible = publicInstances[index];
          if (!visible || !instance.enabled || !supportsMedia(instance.service, media.kind))
            return [];
          return [
            {
              ...visible,
              href: addDestination(instance, media).href,
              checkLibrary:
                Boolean(instance.apiKey) && !(instance.service === "seerr" && media.ids.tmdb),
            },
          ];
        })
      : [],
  };
}
