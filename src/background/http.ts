import type { Instance } from "../shared/settings";

export type Fetcher = typeof fetch;

export function instanceUrl(instance: Pick<Instance, "baseUrl">, path: string): URL {
  return new URL(`${instance.baseUrl}/${path}`);
}

export async function jsonApi(
  instance: Instance,
  path: string,
  fetcher: Fetcher = fetch,
): Promise<unknown> {
  if (!instance.apiKey) throw new Error(`${instance.name}: configure an API key to use the API.`);
  let response: Response;
  try {
    response = await fetcher(instanceUrl(instance, path), {
      headers: { "X-Api-Key": instance.apiKey, Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      `${instance.name}: connection failed. Check the URL, host permission, TLS certificate, and network access. Redirects are not followed.`,
    );
  }
  if (!response.ok) {
    if ([401, 403].includes(response.status))
      throw new Error(
        `${instance.name}: access denied. Check the API key and any reverse-proxy authentication.`,
      );
    throw new Error(`${instance.name}: API returned HTTP ${response.status}.`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(
      `${instance.name}: expected JSON from the API. Check the instance URL and proxy configuration.`,
    );
  }
}
