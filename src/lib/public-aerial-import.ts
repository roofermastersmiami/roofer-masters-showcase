const FALLBACK =
  " Use Add image to upload your own aerial/drone photo, then calibrate and trace it.";
/** Decode locally instead of fetching a data URL, which browser policies may block. */
export function aerialImageBlob(image: string): Blob {
  if (!image.startsWith("data:image/png;base64,"))
    throw new Error("The aerial service returned an invalid image." + FALLBACK);
  try {
    const bytes = Uint8Array.from(atob(image.slice("data:image/png;base64,".length)), (c) =>
      c.charCodeAt(0),
    );
    if (
      bytes.length < 24 ||
      bytes.length > 10 * 1024 * 1024 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
    )
      throw new Error("invalid");
    return new Blob([bytes], { type: "image/png" });
  } catch {
    throw new Error("The aerial image is damaged, empty or larger than 10 MB." + FALLBACK);
  }
}
export async function uploadAerialImage(
  image: string,
  upload: (blob: Blob) => Promise<{ error: { message: string } | null }>,
) {
  const blob = aerialImageBlob(image);
  let result;
  try {
    result = await upload(blob);
  } catch {
    throw new Error(
      "The aerial image was downloaded, but the private photo upload could not connect. Check your connection and retry." +
        FALLBACK,
    );
  }
  if (result.error) {
    const denied = /row.level|unauthorized|not authorized|permission|403|jwt/i.test(
      result.error.message,
    );
    throw new Error(
      (denied
        ? "The aerial image was downloaded, but your session or photo permissions prevented saving it. Sign in again and retry."
        : "The aerial image was downloaded, but private photo storage rejected the upload. Retry or contact the owner.") +
        FALLBACK,
    );
  }
}
export function aerialInvocationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return (
    (/unauthorized|forbidden|access|401|403/i.test(message)
      ? "Your session or team role could not authorize aerial import. Sign in again or contact the owner."
      : "The aerial request could not complete. Check your connection and retry; the free services may be temporarily unavailable.") +
    FALLBACK
  );
}

/** Automatically fetch free imagery only for a newly created address report with no aerial attached. */
export function shouldAutoLoadAddressAerial(input: {
  isNewReport: boolean;
  address: string | null | undefined;
  hasAerial: boolean;
  alreadyAttempted: boolean;
}) {
  return Boolean(
    input.isNewReport && input.address?.trim() && !input.hasAerial && !input.alreadyAttempted,
  );
}
