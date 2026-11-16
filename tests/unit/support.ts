import type { Instance } from "../../src/shared/settings";

export const instance: Instance = {
  id: "radarr",
  name: "Radarr 4K",
  service: "radarr",
  baseUrl: "https://arr.example.test/radarr",
  apiKey: "test-only-key",
  enabled: true,
  iconUrl: "",
  iconData: "",
};

export const seerr: Instance = {
  ...instance,
  id: "seerr",
  name: "Seerr",
  service: "seerr",
  baseUrl: "https://seerr.example.test/requests",
};

export function page(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}
