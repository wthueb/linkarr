import { beforeEach, describe, expect, it, vi } from "vitest";
import { PANEL_ID, renderPanel } from "../../src/content/panel";
import { pageLinks } from "../../src/shared/links";
import type { Media } from "../../src/shared/media";
import { instance } from "./support";

const media: Media = { kind: "movie", title: "<img src=x onerror=alert(1)>", ids: { tmdb: "123" } };
const settings = {
  version: 1 as const,
  enabled: true,
  instances: [
    instance,
    { ...instance, id: "4k", name: "4K", baseUrl: "https://arr.example.test/4k" },
    { ...instance, id: "tv", service: "sonarr" as const, name: "Sonarr" },
  ],
};
const links = pageLinks(settings, media);
let title: HTMLHeadingElement;

beforeEach(() => {
  title = document.createElement("h1");
  title.textContent = media.title;
  document.body.replaceChildren(title);
});

function anchors(): HTMLAnchorElement[] {
  return [
    ...(document
      .getElementById(PANEL_ID)
      ?.shadowRoot?.querySelectorAll<HTMLAnchorElement>(".actions a") ?? []),
  ];
}

describe("instant inline links", () => {
  it("renders usable native links before API checks finish", async () => {
    let finish: (url: string | null) => void = () => undefined;
    const pending = new Promise<string | null>((resolve) => {
      finish = resolve;
    });
    const resolve = vi.fn().mockReturnValue(pending);
    renderPanel(document, links, media, resolve, title);
    const first = anchors()[0];
    expect(first?.href).toBe(`${instance.baseUrl}/add/new?term=tmdb%3A123`);
    expect(first?.target).toBe("_blank");
    expect(first?.rel).toBe("noopener noreferrer");
    expect(first?.getAttribute("aria-label")).toBe(instance.name);
    expect(first?.getAttribute("aria-busy")).toBeNull();
    expect(resolve).toHaveBeenCalledWith(instance.id, media);
    finish(`${instance.baseUrl}/movie/arrival`);
    await vi.waitFor(() => expect(first?.href).toBe(`${instance.baseUrl}/movie/arrival`));
    expect(first?.getAttribute("aria-busy")).toBeNull();
    expect(document.getElementById(PANEL_ID)?.shadowRoot?.querySelector(".status")).toBeNull();
  });
  it("keeps safe title text, matching instances, and a single inline control group", () => {
    const resolve = vi.fn().mockResolvedValue(null);
    renderPanel(document, links, media, resolve, title);
    renderPanel(document, links, media, resolve, title);
    expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
    expect(document.getElementById(PANEL_ID)?.parentElement).toBe(title);
    expect(title.textContent).toBe(media.title);
    expect(title.querySelector("img")).toBeNull();
    expect(anchors()).toHaveLength(2);
    expect(
      document.getElementById(PANEL_ID)?.shadowRoot?.querySelector("button, details"),
    ).toBeNull();
  });
  it("does not query instances without an API key", () => {
    const resolve = vi.fn();
    renderPanel(
      document,
      pageLinks({ ...settings, instances: [{ ...instance, apiKey: "" }] }, media),
      media,
      resolve,
      title,
    );
    expect(anchors()[0]?.href).toContain("/add/new?term=");
    expect(resolve).not.toHaveBeenCalled();
  });
  it.each([null, new Error("Access denied")])(
    "silently preserves the initial link when a lookup cannot resolve: %s",
    async (result) => {
      const resolve =
        result instanceof Error
          ? vi.fn().mockRejectedValue(result)
          : vi.fn().mockResolvedValue(result);
      renderPanel(document, links, media, resolve, title);
      await Promise.resolve();
      await Promise.resolve();
      expect(anchors()[0]?.href).toBe(`${instance.baseUrl}/add/new?term=tmdb%3A123`);
      expect(
        document.getElementById(PANEL_ID)?.shadowRoot?.querySelector('[role="status"]'),
      ).toBeNull();
    },
  );
  it("upgrades each instance independently", async () => {
    const resolve = vi.fn((id: string) =>
      id === "4k"
        ? Promise.resolve("https://arr.example.test/4k/movie/arrival")
        : new Promise<string | null>(() => undefined),
    );
    renderPanel(document, links, media, resolve, title);
    await vi.waitFor(() =>
      expect(anchors()[1]?.href).toBe("https://arr.example.test/4k/movie/arrival"),
    );
    expect(anchors()[0]?.href).toContain("/radarr/add/new?term=");
  });
  it("ignores late results belonging to removed controls", async () => {
    let finish: (url: string | null) => void = () => undefined;
    const pending = new Promise<string | null>((resolve) => {
      finish = resolve;
    });
    renderPanel(document, links, media, () => pending, title);
    const old = anchors()[0];
    renderPanel(document, links, media, async () => null, title);
    finish(`${instance.baseUrl}/movie/stale-title`);
    await Promise.resolve();
    expect(old?.isConnected).toBe(false);
    expect(old?.href).toContain("/add/new?term=");
    expect(anchors()[0]?.href).toContain("/add/new?term=");
  });
  it("does not fall back to a floating panel when the title is missing", () => {
    renderPanel(document, links, media, vi.fn(), null);
    expect(document.getElementById(PANEL_ID)).toBeNull();
  });
  it("moves the controls when the page replaces the title heading", () => {
    renderPanel(document, links, media, async () => null, title);
    const replacement = document.createElement("h1");
    replacement.textContent = media.title;
    title.replaceWith(replacement);
    renderPanel(document, links, media, async () => null, replacement);
    expect(replacement.firstElementChild?.id).toBe(PANEL_ID);
    expect(document.querySelectorAll(`#${PANEL_ID}`)).toHaveLength(1);
  });
  it("removes links when disabled or leaving a title page", () => {
    renderPanel(document, links, media, async () => null, title);
    renderPanel(document, { ...links, enabled: false }, media, vi.fn(), title);
    expect(document.getElementById(PANEL_ID)).toBeNull();
    renderPanel(document, links, null, vi.fn(), title);
    expect(document.getElementById(PANEL_ID)).toBeNull();
  });
});
