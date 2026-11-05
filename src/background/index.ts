import { pageLinks } from "../shared/links";
import { parseMedia, supportedPage } from "../shared/media";
import { errorMessage } from "../shared/messages";
import {
  isRecord,
  loadSettings,
  parseSettings,
  publicSettings,
  SETTINGS_KEY,
} from "../shared/settings";
import { api, findExistingDestination } from "./arr";

const ready = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});

function internal(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id && Boolean(sender.url?.startsWith(chrome.runtime.getURL("")))
  );
}

async function handle(message: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  if (!isRecord(message) || sender.id !== chrome.runtime.id) throw new Error("Invalid request.");
  if (message.type === "get-settings") return publicSettings(await loadSettings());
  if (message.type === "open-settings") {
    await chrome.runtime.openOptionsPage();
    return null;
  }
  if (message.type === "test-connection" && internal(sender)) {
    const settings = parseSettings({
      version: 1,
      enabled: true,
      instances: [message.instance],
    });
    const instance = settings.instances[0];
    if (!instance) throw new Error("Missing instance.");
    const status = await api(instance, "system/status");
    if (
      !isRecord(status) ||
      typeof status.version !== "string" ||
      typeof status.appName !== "string" ||
      status.appName.toLowerCase() !== instance.service
    ) {
      throw new Error("This URL is not the selected Radarr/Sonarr service.");
    }
    return `${status.appName} ${status.version}`;
  }
  if (message.type === "get-links" || message.type === "resolve-link") {
    if (!sender.tab || !sender.url || !supportedPage(new URL(sender.url)))
      throw new Error("Open a supported content page first.");
    const settings = await loadSettings();
    const media = parseMedia(message.media);
    if (message.type === "get-links") return pageLinks(settings, media);
    const instance = settings.instances.find(
      (item) => item.id === message.instanceId && item.enabled,
    );
    if (!settings.enabled || !instance?.apiKey) return null;
    const permitted = await chrome.permissions.contains({
      origins: [`${new URL(instance.baseUrl).origin}/*`],
    });
    if (!permitted) return null;
    try {
      return (await findExistingDestination(instance, media))?.href ?? null;
    } catch {
      return null;
    }
  }
  throw new Error("Unsupported request.");
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  handle(message, sender).then(
    (value) => sendResponse({ ok: true, value }),
    (error: unknown) => sendResponse({ ok: false, error: errorMessage(error) }),
  );
  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_KEY]) return;
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined)
        void chrome.tabs.sendMessage(tab.id, { type: "settings-changed" }).catch(() => undefined);
    }
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.runtime.openOptionsPage();
});
