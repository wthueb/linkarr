import type { Media } from "./media";
import type { Service } from "./settings";

export const SERVICE_BADGES: Record<Service, string> = {
  radarr: "R",
  sonarr: "S",
  seerr: "E",
};

export function supportsMedia(service: Service, kind: Media["kind"]): boolean {
  return service === "seerr" || (service === "radarr") === (kind === "movie");
}
