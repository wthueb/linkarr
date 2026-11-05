import type { PageLinks } from "./links";
import type { Media } from "./media";

export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

export async function request<T>(message: Record<string, unknown>): Promise<T> {
  const reply: Reply<T> | undefined = await chrome.runtime.sendMessage(message);
  if (!reply)
    throw new Error("Linkarr did not respond. Reload this page after updating the extension.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.value;
}

export function getPageLinks(media: Media): Promise<PageLinks> {
  return request({ type: "get-links", media });
}

export function resolveLink(instanceId: string, media: Media): Promise<string | null> {
  return request({ type: "resolve-link", instanceId, media });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "An unexpected error occurred.";
}
