import { httpUrl } from "../shared/settings";

export async function cacheIcon(value: string): Promise<string> {
  const url = httpUrl(value);
  if (!(await chrome.permissions.request({ origins: [`${url.origin}/*`] }))) {
    throw new Error("Icon host access was not granted.");
  }
  const response = await fetch(url, {
    credentials: "omit",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Icon request returned HTTP ${response.status}.`);
  if (!response.headers.get("content-type")?.startsWith("image/"))
    throw new Error("The icon URL must return an image.");
  const blob = await response.blob();
  if (blob.size > 1024 * 1024) throw new Error("Choose an icon smaller than 1 MiB.");
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 16_777_216)
      throw new Error("Choose an icon smaller than 16 megapixels.");
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the icon preview.");
    const ratio = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
    const width = image.naturalWidth * ratio;
    const height = image.naturalHeight * ratio;
    context.drawImage(image, (64 - width) / 2, (64 - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
