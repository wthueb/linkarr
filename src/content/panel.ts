import type { PageLinks } from "../shared/links";
import type { Media } from "../shared/media";
import styles from "./style.css?inline";

export const PANEL_ID = "linkarr-panel";

export function renderPanel(
  doc: Document,
  settings: PageLinks,
  media: Media | null,
  resolve: (instanceId: string, media: Media) => Promise<string | null>,
  title: HTMLElement | null,
): HTMLElement | null {
  doc.getElementById(PANEL_ID)?.remove();
  if (!settings.enabled || !media || !title) return null;
  const instances = settings.instances.filter(
    (instance) => instance.enabled && (instance.service === "radarr") === (media.kind === "movie"),
  );
  if (!instances.length) return null;
  const host = doc.createElement("span");
  host.id = PANEL_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = styles;
  shadow.append(style);
  const actions = doc.createElement("span");
  actions.className = "actions";
  actions.setAttribute("role", "group");
  actions.setAttribute("aria-label", "Open in Radarr or Sonarr");
  const checks: (() => void)[] = [];
  for (const instance of instances) {
    const button = doc.createElement("a");
    button.href = instance.href;
    button.target = "_blank";
    button.rel = "noopener noreferrer";
    button.title = `Open ${media.title} in ${instance.name}`;
    button.setAttribute("aria-label", instance.name);
    const icon = doc.createElement("span");
    icon.className = `icon ${instance.service}`;
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = instance.service === "radarr" ? "R" : "S";
    if (instance.iconData) {
      const image = doc.createElement("img");
      image.src = instance.iconData;
      image.alt = "";
      image.addEventListener("error", () => image.remove());
      icon.append(image);
    }
    button.append(icon);
    if (instance.checkLibrary) {
      checks.push(() => {
        void resolve(instance.id, media)
          .then((href) => {
            if (href && host.isConnected && button.isConnected) button.href = href;
          })
          .catch(() => null);
      });
    }
    actions.append(button);
  }
  shadow.append(actions);
  title.prepend(host);
  for (const check of checks) check();
  return host;
}
