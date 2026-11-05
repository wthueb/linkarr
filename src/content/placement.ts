import { supportedPage } from "../shared/media";

export function findTitleElement(doc: Document, href: string): HTMLElement | null {
  const url = new URL(href);
  if (!supportedPage(url)) return null;
  const host = url.hostname.replace(/^(www\.|m\.)/, "");
  const selectors =
    host === "imdb.com"
      ? ['h1[data-testid="hero__pageTitle"]', "h1"]
      : host === "themoviedb.org"
        ? [".header .title h2", "h1"]
        : host === "thetvdb.com"
          ? ["#series_title", "h1"]
          : ["main h1", "h1"];
  for (const selector of selectors) {
    const title = doc.querySelector<HTMLElement>(selector);
    if (title) return title;
  }
  return null;
}
