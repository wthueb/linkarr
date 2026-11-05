import type { Media } from "./media";
import { type Instance, type PublicInstance, publicSettings, type Settings } from "./settings";

export interface MediaLink extends PublicInstance {
  href: string;
  checkLibrary: boolean;
}

export interface PageLinks {
  enabled: boolean;
  instances: MediaLink[];
}

export function addDestination(instance: Pick<Instance, "baseUrl" | "service">, media: Media): URL {
  if ((instance.service === "radarr") !== (media.kind === "movie")) {
    throw new Error("This instance does not handle this media type.");
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
          if (
            !visible ||
            !instance.enabled ||
            (instance.service === "radarr") !== (media.kind === "movie")
          )
            return [];
          return [
            {
              ...visible,
              href: addDestination(instance, media).href,
              checkLibrary: Boolean(instance.apiKey),
            },
          ];
        })
      : [],
  };
}
