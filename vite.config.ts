import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const matches = [
  "https://*.imdb.com/*",
  "https://*.themoviedb.org/*",
  "https://*.thetvdb.com/*",
  "https://*.mdblist.com/*",
];

export default defineConfig(({ mode }) => {
  const script = mode === "content" || mode === "background";
  return {
    base: "./",
    plugins: script
      ? []
      : [
          {
            name: "linkarr-manifest",
            generateBundle() {
              this.emitFile({
                type: "asset",
                fileName: "manifest.json",
                source: JSON.stringify(
                  {
                    manifest_version: 3,
                    name: "Linkarr",
                    version: pkg.version,
                    description:
                      "Open movies and TV shows from IMDb, TMDB, TVDB, and MDBList in your Radarr and Sonarr libraries.",
                    minimum_chrome_version: "120",
                    permissions: ["storage"],
                    optional_host_permissions: ["http://*/*", "https://*/*"],
                    background: { service_worker: "background.js" },
                    action: {
                      default_popup: "popup.html",
                      default_title: "Linkarr",
                      default_icon: { 16: "icons/16.png", 32: "icons/32.png" },
                    },
                    icons: {
                      16: "icons/16.png",
                      32: "icons/32.png",
                      48: "icons/48.png",
                      128: "icons/128.png",
                    },
                    options_ui: { page: "options.html", open_in_tab: true },
                    content_scripts: [{ matches, js: ["content.js"], run_at: "document_idle" }],
                    content_security_policy: {
                      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
                    },
                  },
                  null,
                  2,
                ),
              });
            },
          },
        ],
    build: {
      target: "chrome120",
      outDir: "dist",
      emptyOutDir: !script,
      copyPublicDir: !script,
      sourcemap: true,
      ...(script
        ? {
            lib: {
              entry: resolve(`src/${mode}/index.ts`),
              name: `Linkarr_${mode}`,
              formats: ["iife"] as ["iife"],
              fileName: () => `${mode}.js`,
            },
          }
        : {
            rolldownOptions: {
              input: {
                options: resolve("options.html"),
                popup: resolve("popup.html"),
              },
            },
          }),
    },
  };
});
