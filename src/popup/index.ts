import "../ui.css";
import { errorMessage } from "../shared/messages";
import { loadSettings, type Settings, saveSettings } from "../shared/settings";

const enabled = document.querySelector<HTMLInputElement>("#enabled");
const status = document.querySelector<HTMLElement>("#status");
const shortcuts = document.querySelector("#shortcuts");
const version = document.querySelector(".version");
if (!enabled || !status || !shortcuts || !version) throw new Error("Missing popup elements.");
const checkbox = enabled;
const statusText = status;
let settings: Settings;
version.textContent = `v${chrome.runtime.getManifest().version}`;
checkbox.disabled = true;

checkbox.addEventListener("change", async () => {
  checkbox.disabled = true;
  try {
    settings.enabled = checkbox.checked;
    await saveSettings(settings);
    statusText.textContent = settings.enabled ? "Page links enabled." : "Page links paused.";
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    statusText.textContent = errorMessage(error);
  } finally {
    checkbox.disabled = false;
  }
});
document.querySelector("#settings")?.addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

try {
  settings = await loadSettings();
  checkbox.checked = settings.enabled;
  checkbox.disabled = false;
  for (const instance of settings.instances.filter((item) => item.enabled)) {
    const link = document.createElement("a");
    link.href = instance.baseUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    if (instance.iconData) {
      const icon = document.createElement("img");
      icon.src = instance.iconData;
      icon.alt = "";
      link.append(icon);
    }
    const label = document.createElement("span");
    label.textContent = instance.name;
    link.append(label);
    shortcuts.append(link);
  }
  statusText.textContent = settings.instances.length
    ? "Visit a movie or show on IMDb, TMDB, TVDB, or MDBList."
    : "Add a Radarr or Sonarr instance to get started.";
} catch (error) {
  statusText.textContent = errorMessage(error);
}
