/**
 * pdf.js worker entry used by the PDF Studio tests.
 *
 * pdf.js 6's worker uses stage-4 APIs (Uint8Array.prototype.toHex,
 * Map/WeakMap upsert methods) that exist in current browsers and
 * Node >= 24 but NOT in the Node 22.12 used by CI — and the worker runs
 * in its own realm, so polyfills applied by the test file in the main
 * thread never reach it. Without them the worker stalls mid-parse and
 * every pdf.js-backed test burns its full timeout, which looks like a
 * hung CI job.
 *
 * The polyfills module is imported first so it evaluates before the
 * real worker bundle; the worker's exports are re-exported so pdf.js's
 * fake-worker loader finds WorkerMessageHandler. Production code is
 * unaffected: browsers load the bundled worker directly and already
 * have these APIs.
 */
import "./pdfjs-polyfills.mjs";

export * from "../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
