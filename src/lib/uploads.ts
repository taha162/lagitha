/**
 * What to hand to the image decoder.
 *
 * Deliberately generous. The MIME type a phone attaches is not reliable:
 * Android file pickers routinely send `application/octet-stream`, some send
 * `image/jpg`, and a share sheet may send nothing at all. A strict allow-list
 * turned real photographs from real phones away and told their owner the file
 * type was unsupported — which was both wrong and unfixable from their side.
 *
 * Every upload is decoded and re-encoded to WebP anyway, so the decoder is the
 * real gate: whatever the client claims, what reaches storage is a freshly
 * encoded image. This check exists only to turn away something that announces
 * itself as another kind of file entirely, before eight megabytes are decoded.
 */
export function couldBeAnImage(type: string | undefined | null): boolean {
  if (!type) return true;

  const normalised = type.trim().toLowerCase().split(";")[0] ?? "";
  if (normalised === "" || normalised === "application/octet-stream") return true;

  return normalised.startsWith("image/");
}
