import { supabase } from "@/integrations/supabase/client";
import { validPdfHeader } from "@/lib/proposal-schema";

/**
 * Fetch a stored PDF's bytes with real download progress.
 *
 * The primary path asks storage for a short-lived signed URL and
 * streams that GET, so the caller sees true byte progress
 * (loaded / content-length). Anything that goes wrong there — no
 * signed URL, a blocked or failed fetch, a stalled connection —
 * falls back to the storage client's own download, which is the
 * path the rest of the CRM already uses. Either way the bytes are
 * header-checked: a stored object that is not actually a PDF is a
 * hard error here, never something the viewer should sit on.
 */

export type PdfFetchProgress = {
  /** Bytes received so far. */
  loaded: number;
  /** Total bytes when the server reported a content length, else null. */
  total: number | null;
  /** loaded / total when the total is known, else null. */
  fraction: number | null;
};

export type PdfFetchOptions = {
  onProgress?: (progress: PdfFetchProgress) => void;
  signal?: AbortSignal;
};

/** AbortSignal.any where the platform has it, a manual fan-in where
 * it doesn't (older DOM implementations). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

const SIGNED_URL_SECONDS = 120;
/** A signed-URL fetch that stalls longer than this is abandoned for
 * the storage-client download instead of hanging the viewer. */
const SIGNED_FETCH_TIMEOUT_MS = 90_000;

async function fetchViaSignedUrl(
  bucket: string,
  path: string,
  options: PdfFetchOptions,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error("Could not create a link to the PDF");

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SIGNED_FETCH_TIMEOUT_MS);
  const signal = options.signal ? anySignal([options.signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(data.signedUrl, { signal });
    if (!response.ok) throw new Error(`PDF download failed (${response.status})`);
    const lengthHeader = response.headers.get("content-length");
    const parsedLength = lengthHeader ? Number(lengthHeader) : NaN;
    const total = Number.isFinite(parsedLength) && parsedLength > 0 ? parsedLength : null;
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      options.onProgress?.({ loaded: bytes.length, total: total ?? bytes.length, fraction: 1 });
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        chunks.push(value);
        loaded += value.length;
        options.onProgress?.({
          loaded,
          total,
          fraction: total ? Math.min(1, loaded / total) : null,
        });
      }
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaStorageDownload(
  bucket: string,
  path: string,
  options: PdfFetchOptions,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw error ?? new Error("PDF file not found");
  const bytes = new Uint8Array(await data.arrayBuffer());
  options.onProgress?.({ loaded: bytes.length, total: bytes.length, fraction: 1 });
  return bytes;
}

/**
 * Download the PDF stored at `bucket`/`path` and return its bytes.
 * Throws a plain-language error when the file cannot be fetched or
 * is not a valid PDF — callers must surface it, never render around
 * it.
 */
export async function fetchStoragePdf(
  bucket: string,
  path: string,
  options: PdfFetchOptions = {},
): Promise<Uint8Array> {
  let bytes: Uint8Array;
  try {
    bytes = await fetchViaSignedUrl(bucket, path, options);
  } catch (cause) {
    // A caller-driven abort is final; anything else gets the
    // storage client's download as a second chance.
    if (options.signal?.aborted) throw cause;
    bytes = await fetchViaStorageDownload(bucket, path, options);
  }
  if (!validPdfHeader(bytes)) {
    throw new Error("The file stored for this document is not a valid PDF");
  }
  return bytes;
}
