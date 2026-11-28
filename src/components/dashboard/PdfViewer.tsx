import { useEffect, useState } from "react";
import { AlertTriangle, Download, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { timedProgressPercent, type TimedProgressPhase } from "@/lib/analysis-progress";
import { fetchStoragePdf } from "@/lib/pdf-fetch";
import type { PdfPagePreview } from "@/lib/pdf-tools-browser";

/**
 * In-app viewer for a stored PDF. It renders the document itself —
 * pdf.js draws every page to an image — instead of pointing an
 * iframe at a blob: URL and hoping the browser's built-in PDF
 * plugin renders it. That plugin silently shows a white page when
 * it won't handle blob: URLs (Safari on macOS, Chrome's
 * download-instead-of-open setting, a disabled plugin), and the old
 * viewer had no way to notice: the loading flag flipped off the
 * moment the bytes arrived and the user stared at white forever.
 *
 * Loading shows a real 0–100%: the download phase reports actual
 * bytes (loaded / content-length, mapped to 0–70) when the fetch
 * provides them and creeps asymptotically inside the same band when
 * it doesn't; the render phase advances by pages actually drawn
 * (70–100). 100 appears only once every page is rendered, briefly,
 * before the pages swap in. Any failure lands on an explicit error
 * with retry and download actions — never an endless white page.
 */

type ViewerState =
  | { kind: "loading"; percent: number; label: string }
  | { kind: "ready"; pages: PdfPagePreview[] }
  | { kind: "error"; message: string };

/** Download owns 0–70: byte-hungry (report PDFs embed a full aerial
 * photo) but usually quick; without a content length it creeps
 * inside the band, never past it. */
const DOWNLOAD_PHASE: TimedProgressPhase = { floor: 0, cap: 70, tauSeconds: 8 };
const RENDER_FLOOR = 70;
const TICK_MS = 200;
/** How long the finished 100% stays up before the pages swap in. */
const COMPLETE_LINGER_MS = 500;

export function PdfViewer({
  bucket,
  path,
  zoom = 1,
  onDownload,
}: {
  bucket: string;
  path: string;
  zoom?: number;
  onDownload?: () => void;
}) {
  const [state, setState] = useState<ViewerState>({
    kind: "loading",
    percent: 0,
    label: "Downloading PDF…",
  });
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let percent = 0;
    let fraction: number | null = null;
    const startedAt = Date.now();
    const timers: number[] = [];

    const showLoading = (label: string) => {
      if (active) setState({ kind: "loading", percent, label });
    };
    const raisePercent = (next: number) => {
      percent = Math.max(percent, Math.min(100, Math.round(next)));
    };

    // While the download has no measurable fraction, keep the
    // number honestly moving inside the download band.
    const ticker = window.setInterval(() => {
      if (fraction === null) {
        raisePercent(
          timedProgressPercent(DOWNLOAD_PHASE, (Date.now() - startedAt) / 1000, percent),
        );
        showLoading("Downloading PDF…");
      }
    }, TICK_MS);
    timers.push(ticker);

    void (async () => {
      try {
        const bytes = await fetchStoragePdf(bucket, path, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (progress.fraction !== null) {
              fraction = progress.fraction;
              raisePercent(fraction * DOWNLOAD_PHASE.cap);
              showLoading("Downloading PDF…");
            }
          },
        });
        if (!active) return;
        window.clearInterval(ticker);
        raisePercent(RENDER_FLOOR);
        showLoading("Preparing pages…");
        // pdf.js is dynamically imported, per the project's PDF
        // rule, so it stays out of the initial bundle.
        const { renderPdfPagePreviews } = await import("@/lib/pdf-tools-browser");
        const pages = await renderPdfPagePreviews(bytes, {
          onPage: (done, total) => {
            raisePercent(RENDER_FLOOR + (done / Math.max(1, total)) * (100 - RENDER_FLOOR));
            showLoading(
              done < total ? `Preparing page ${done + 1} of ${total}…` : "Preparing pages…",
            );
          },
        });
        if (!active) return;
        percent = 100;
        showLoading("Ready");
        await new Promise((resolve) => {
          timers.push(window.setTimeout(resolve, COMPLETE_LINGER_MS));
        });
        if (active) setState({ kind: "ready", pages });
      } catch (cause) {
        if (!active || controller.signal.aborted) return;
        setState({
          kind: "error",
          message: cause instanceof Error ? cause.message : "The PDF could not be loaded.",
        });
      } finally {
        window.clearInterval(ticker);
      }
    })();

    return () => {
      active = false;
      controller.abort();
      for (const timer of timers) {
        window.clearInterval(timer);
        window.clearTimeout(timer);
      }
    };
  }, [bucket, path, runKey]);

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={`${state.label} ${state.percent}%`}
        className="flex h-full min-h-[50vh] flex-col items-center justify-center p-10 text-center"
      >
        <p className="text-5xl font-bold tabular-nums">{state.percent}%</p>
        <p className="mt-2 text-sm font-medium">{state.label}</p>
        <Progress
          className="mt-4 w-72 max-w-full"
          value={state.percent}
          aria-label={`Loading PDF: ${state.percent}%`}
        />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 p-10 text-center"
      >
        <AlertTriangle className="size-8 text-destructive" />
        <p className="font-medium">This PDF could not be displayed</p>
        <p className="max-w-md text-sm text-muted-foreground">{state.message}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button type="button" variant="outline" onClick={() => setRunKey((key) => key + 1)}>
            <RotateCw /> Try again
          </Button>
          {onDownload && (
            <Button type="button" onClick={onDownload}>
              <Download /> Download the PDF instead
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto py-3" style={{ width: `${100 * zoom}%`, minHeight: `${70 * zoom}vh` }}>
      {state.pages.map((page) => (
        <img
          key={page.pageNumber}
          src={page.dataUrl}
          alt={`Page ${page.pageNumber}`}
          className="mx-auto mb-3 block w-full max-w-full bg-white shadow"
        />
      ))}
    </div>
  );
}
