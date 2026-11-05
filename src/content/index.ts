import { getPageLinks, resolveLink } from "../shared/messages";
import { detectMedia } from "./detect";
import { renderPanel } from "./panel";
import { findTitleElement } from "./placement";

let signature = "";
let scheduled = false;
let lastUrl = location.href;
let lastTitle: HTMLElement | null = null;
let controls: HTMLElement | null = null;
let generation = 0;

async function render(force = false): Promise<void> {
  scheduled = false;
  const media = detectMedia(document, location.href);
  const title = findTitleElement(document, location.href);
  const next = JSON.stringify({ href: location.href, media });
  if (
    !force &&
    signature === next &&
    lastTitle === title &&
    (!controls || (controls.isConnected && controls.parentElement === title))
  )
    return;
  const current = ++generation;
  signature = next;
  lastTitle = title;
  controls?.remove();
  controls = null;
  if (!media || !title) return;
  try {
    const links = await getPageLinks(media);
    if (current !== generation) return;
    if (
      title !== findTitleElement(document, location.href) ||
      next !== JSON.stringify({ href: location.href, media: detectMedia(document, location.href) })
    ) {
      schedule();
      return;
    }
    controls = renderPanel(document, links, media, resolveLink, title);
  } catch {
    if (current === generation) signature = "";
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  window.setTimeout(() => {
    void render();
  }, 50);
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: ["content", "href", "class", "id", "data-testid"],
});
window.setInterval(() => {
  if (lastUrl !== location.href) {
    lastUrl = location.href;
    schedule();
  }
}, 1000);
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "settings-changed"
  )
    void render(true);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule();
});
void render();
