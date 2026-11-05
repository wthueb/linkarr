import { describe, expect, it } from "vitest";
import { parseMedia, supportedPage } from "../../src/shared/media";
import {
  DEFAULT_SETTINGS,
  normalizeBaseUrl,
  parseSettings,
  publicSettings,
} from "../../src/shared/settings";
import { instance } from "./support";

describe("settings validation", () => {
  it("starts with no instances", () => {
    expect(parseSettings(DEFAULT_SETTINGS).instances).toEqual([]);
  });
  it("preserves reverse proxy paths", () => {
    expect(normalizeBaseUrl(" https://example.test/arr/radarr/ ")).toBe(
      "https://example.test/arr/radarr",
    );
  });
  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://user:password@example.test",
    "https://example.test/?apiKey=secret",
    "https://example.test/#x",
    "not-a-url",
  ])("rejects unsafe base URL %s", (baseUrl) => {
    expect(() =>
      parseSettings({
        ...DEFAULT_SETTINGS,
        instances: [{ ...instance, baseUrl }],
      }),
    ).toThrow();
  });
  it("accepts optional API keys but requires unique IDs", () => {
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, instances: [{ ...instance, apiKey: "" }] }).instances[0]
        ?.apiKey,
    ).toBe("");
    expect(
      parseSettings({ ...DEFAULT_SETTINGS, instances: [{ ...instance, apiKey: undefined }] })
        .instances[0]?.apiKey,
    ).toBe("");
    expect(() =>
      parseSettings({ ...DEFAULT_SETTINGS, instances: [{ ...instance, apiKey: "invalid key" }] }),
    ).toThrow(/API key/);
    expect(() => parseSettings({ ...DEFAULT_SETTINGS, instances: [instance, instance] })).toThrow(
      /unique/,
    );
  });
  it("supports multiple instances of either service", () => {
    const parsed = parseSettings({
      ...DEFAULT_SETTINGS,
      instances: [
        instance,
        { ...instance, id: "4k", name: "4K" },
        { ...instance, id: "tv", service: "sonarr" },
      ],
    });
    expect(parsed.instances).toHaveLength(3);
  });
  it("never exposes API keys, private server URLs, or icon sources to content scripts", () => {
    const result = JSON.stringify(publicSettings({ ...DEFAULT_SETTINGS, instances: [instance] }));
    expect(result).not.toContain(instance.apiKey);
    expect(result).not.toContain(instance.baseUrl);
    expect(result).not.toContain("iconUrl");
  });
  it("rejects SVG or arbitrary data in cached icons", () => {
    expect(() =>
      parseSettings({
        ...DEFAULT_SETTINGS,
        instances: [{ ...instance, iconData: "data:image/svg+xml,<svg/>" }],
      }),
    ).toThrow(/PNG/);
  });
  it("does not erase unsupported versions silently", () => {
    expect(() => parseSettings({ version: 99 })).toThrow(/Unsupported/);
  });
});

describe("message boundary", () => {
  it("rejects untrusted media", () => {
    for (const value of [
      null,
      {},
      { kind: "movie", title: "X", ids: { imdb: "../../secret" } },
      { kind: "movie", title: "X", ids: {}, year: 0 },
    ])
      expect(() => parseMedia(value)).toThrow();
  });
  it("only accepts known HTTPS source hosts", () => {
    expect(supportedPage(new URL("https://www.imdb.com/title/tt1234567"))).toBe(true);
    expect(supportedPage(new URL("https://imdb.com.evil.test/title/tt1234567"))).toBe(false);
    expect(supportedPage(new URL("http://imdb.com/title/tt1234567"))).toBe(false);
  });
});
