export type Service = "radarr" | "sonarr";

export interface Instance {
  id: string;
  name: string;
  service: Service;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  iconUrl: string;
  iconData: string;
}

export interface Settings {
  version: 1;
  enabled: boolean;
  instances: Instance[];
}

export type PublicInstance = Pick<Instance, "id" | "name" | "service" | "enabled" | "iconData">;
export interface PublicSettings {
  enabled: boolean;
  instances: PublicInstance[];
}

export const SETTINGS_KEY = "linkarr.settings";
export const MAX_INSTANCES = 32;
export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  enabled: true,
  instances: [],
};

export function httpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a complete http:// or https:// URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Use an HTTP(S) URL without embedded credentials.");
  }
  return url;
}

export function normalizeBaseUrl(value: string): string {
  const url = httpUrl(value);
  if (url.search || url.hash) throw new Error("Instance URLs cannot contain a query or fragment.");
  return url.href.replace(/\/+$/, "");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${field}.`);
  return value.trim();
}

export function parseSettings(value: unknown): Settings {
  if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== "boolean") {
    throw new Error(
      "Unsupported settings format. Open Linkarr settings to configure your instances.",
    );
  }
  if (!Array.isArray(value.instances) || value.instances.length > MAX_INSTANCES) {
    throw new Error(`Configure at most ${MAX_INSTANCES} instances.`);
  }
  const ids = new Set<string>();
  const instances = value.instances.map((raw: unknown): Instance => {
    if (!isRecord(raw)) throw new Error("Invalid instance.");
    const id = string(raw.id, "instance ID", 64);
    const name = string(raw.name, "instance name", 80);
    if (!/^[\w-]+$/.test(id) || ids.has(id)) throw new Error("Instance IDs must be unique.");
    ids.add(id);
    if (!name) throw new Error("Every instance needs a name.");
    if (raw.service !== "radarr" && raw.service !== "sonarr") throw new Error("Invalid service.");
    if (typeof raw.enabled !== "boolean") throw new Error("Invalid enabled setting.");
    const apiKey = raw.apiKey === undefined ? "" : string(raw.apiKey, "API key", 256);
    if (/\s/.test(apiKey)) throw new Error(`${name}: enter an API key without whitespace.`);
    const iconUrl = string(raw.iconUrl, "icon URL", 2048);
    if (iconUrl) httpUrl(iconUrl);
    const iconData = string(raw.iconData, "cached icon", 131072);
    if (iconData && !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(iconData)) {
      throw new Error(`${name}: custom icons must be cached PNG images.`);
    }
    return {
      id,
      name,
      service: raw.service,
      baseUrl: normalizeBaseUrl(string(raw.baseUrl, "instance URL", 2048)),
      apiKey,
      enabled: raw.enabled,
      iconUrl,
      iconData,
    };
  });
  return { version: 1, enabled: value.enabled, instances };
}

export function publicSettings(settings: Settings): PublicSettings {
  return {
    enabled: settings.enabled,
    instances: settings.instances.map(({ id, name, service, enabled, iconData }) => ({
      id,
      name,
      service,
      enabled,
      iconData,
    })),
  };
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return stored[SETTINGS_KEY] === undefined
    ? structuredClone(DEFAULT_SETTINGS)
    : parseSettings(stored[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: parseSettings(settings) });
}
