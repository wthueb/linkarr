import "../ui.css";
import { errorMessage, request } from "../shared/messages";
import {
  type Instance,
  loadSettings,
  MAX_INSTANCES,
  parseSettings,
  type Settings,
  saveSettings,
} from "../shared/settings";
import { cacheIcon } from "./icons";

function element<T extends Element>(selector: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`Missing settings element: ${selector}`);
  return node;
}

const form = element<HTMLFormElement>("#settings-form");
const container = element<HTMLDivElement>("#instances");
const status = element<HTMLParagraphElement>("#status");
const save = element<HTMLButtonElement>("#save");
const enabled = element<HTMLInputElement>("#enabled");
const add = element<HTMLButtonElement>("#add-instance");
element(".version").textContent = `v${chrome.runtime.getManifest().version}`;

function input(card: Element, name: string): HTMLInputElement {
  return element<HTMLInputElement>(`[name="${name}"]`, card);
}

function updateList(): void {
  const cards = [...container.querySelectorAll<HTMLElement>(".instance-card")];
  element<HTMLElement>("#empty").hidden = cards.length > 0;
  add.disabled = cards.length >= MAX_INSTANCES;
  cards.forEach((card, index) => {
    element<HTMLButtonElement>(".move-up", card).disabled = index === 0;
    element<HTMLButtonElement>(".move-down", card).disabled = index === cards.length - 1;
  });
}

function preview(card: HTMLElement): void {
  const service = element<HTMLSelectElement>('[name="service"]', card).value;
  const name = input(card, "name").value.trim() || "New instance";
  element(".card-title", card).textContent = name;
  element("legend", card).textContent = name;
  const icon = element<HTMLElement>(".instance-preview", card);
  icon.textContent = service === "radarr" ? "R" : "S";
  icon.dataset.service = service;
  if (card.dataset.iconData) {
    const img = document.createElement("img");
    img.src = card.dataset.iconData;
    img.alt = "";
    icon.replaceChildren(img);
  }
}

function readInstance(card: HTMLElement): Instance {
  const iconUrl = input(card, "iconUrl").value.trim();
  if (iconUrl && (iconUrl !== card.dataset.cachedUrl || !card.dataset.iconData)) {
    throw new Error("Load the custom icon before saving, or choose the default icon.");
  }
  const settings = parseSettings({
    version: 1,
    enabled: true,
    instances: [
      {
        id: card.dataset.id,
        name: input(card, "name").value,
        service: element<HTMLSelectElement>('[name="service"]', card).value,
        baseUrl: input(card, "baseUrl").value,
        apiKey: input(card, "apiKey").value,
        enabled: input(card, "enabled").checked,
        iconUrl,
        iconData: iconUrl ? (card.dataset.iconData ?? "") : "",
      },
    ],
  });
  const instance = settings.instances[0];
  if (!instance) throw new Error("Missing instance.");
  return instance;
}

async function grant(instances: Instance[]): Promise<boolean> {
  const origins = [
    ...new Set(
      instances
        .filter((instance) => instance.enabled && instance.apiKey)
        .map((instance) => `${new URL(instance.baseUrl).origin}/*`),
    ),
  ];
  return !origins.length || (await chrome.permissions.request({ origins }));
}

function addCard(instance?: Instance): void {
  const template = element<HTMLTemplateElement>("#instance-template");
  const fragment = template.content.cloneNode(true) as DocumentFragment;
  const card = element<HTMLElement>(".instance-card", fragment);
  card.dataset.id = instance?.id ?? crypto.randomUUID();
  card.dataset.iconData = instance?.iconData ?? "";
  card.dataset.cachedUrl = instance?.iconUrl ?? "";
  if (instance) {
    for (const name of ["name", "baseUrl", "apiKey", "iconUrl"] as const)
      input(card, name).value = instance[name];
    element<HTMLSelectElement>('[name="service"]', card).value = instance.service;
    input(card, "enabled").checked = instance.enabled;
  }
  card.addEventListener("input", () => {
    preview(card);
    status.textContent = "You have unsaved changes.";
  });
  const cardStatus = element<HTMLElement>(".card-status", card);
  element(".remove", card).addEventListener("click", () => {
    card.remove();
    updateList();
    status.textContent = "Save to apply the removal.";
  });
  element(".move-up", card).addEventListener("click", () => {
    if (card.previousElementSibling) container.insertBefore(card, card.previousElementSibling);
    updateList();
    status.textContent = "Save to apply the new order.";
  });
  element(".move-down", card).addEventListener("click", () => {
    if (card.nextElementSibling) container.insertBefore(card.nextElementSibling, card);
    updateList();
    status.textContent = "Save to apply the new order.";
  });
  const test = element<HTMLButtonElement>(".test-connection", card);
  test.addEventListener("click", async () => {
    test.disabled = true;
    try {
      const current = readInstance(card);
      if (!current.apiKey)
        throw new Error("Enter an API key to test the connection. Links work without one.");
      if (!(await grant([{ ...current, enabled: true }])))
        throw new Error("Server host access was not granted. Add/search links still work.");
      cardStatus.textContent = "Connecting…";
      const version = await request<string>({
        type: "test-connection",
        instance: current,
      });
      cardStatus.textContent = `Connected · ${version}`;
    } catch (error) {
      cardStatus.textContent = errorMessage(error);
    } finally {
      test.disabled = false;
    }
  });
  const load = element<HTMLButtonElement>(".load-icon", card);
  load.addEventListener("click", async () => {
    load.disabled = true;
    try {
      const url = input(card, "iconUrl").value.trim();
      const data = await cacheIcon(url);
      card.dataset.iconData = data;
      card.dataset.cachedUrl = url;
      preview(card);
      cardStatus.textContent = "Icon loaded. Save settings to apply it.";
    } catch (error) {
      cardStatus.textContent = `Could not load icon: ${errorMessage(error)}`;
    } finally {
      load.disabled = false;
    }
  });
  element(".reset-icon", card).addEventListener("click", () => {
    input(card, "iconUrl").value = "";
    card.dataset.iconData = "";
    card.dataset.cachedUrl = "";
    preview(card);
    cardStatus.textContent = "Default icon selected. Save settings to apply it.";
  });
  container.append(fragment);
  preview(card);
  updateList();
}

add.addEventListener("click", () => {
  if (container.children.length >= MAX_INSTANCES) return;
  addCard();
  container.lastElementChild?.querySelector<HTMLInputElement>('[name="name"]')?.focus();
});

enabled.addEventListener("change", () => {
  status.textContent = "You have unsaved changes.";
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  save.disabled = true;
  try {
    const settings: Settings = {
      version: 1,
      enabled: enabled.checked,
      instances: [...container.querySelectorAll<HTMLElement>(".instance-card")].map(readInstance),
    };
    const granted = await grant(settings.instances);
    await saveSettings(settings);
    status.textContent = granted
      ? "Settings saved. Open or reload a supported content page to use Linkarr."
      : "Settings saved. API access was not granted; add/search links still work.";
  } catch (error) {
    status.textContent = errorMessage(error);
  } finally {
    save.disabled = false;
  }
});

async function init(): Promise<void> {
  try {
    const settings = await loadSettings();
    enabled.checked = settings.enabled;
    settings.instances.forEach(addCard);
    updateList();
  } catch (error) {
    status.textContent = errorMessage(error);
    enabled.checked = true;
  }
}
void init();
