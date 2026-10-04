import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

export function PdfPages({ url }: { url: string }) {
  const scrollRoot = useRef<HTMLDivElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    let live = true;
    let destroy = () => {};
    void import("pdfjs-dist").then(({ getDocument, GlobalWorkerOptions }) => {
      if (!live) return;
      GlobalWorkerOptions.workerSrc = workerSrc;
      const task = getDocument(url);
      destroy = () => { void task.destroy(); };
      return task.promise.then((pdf) => {
        if (live) setDocument(pdf);
        else void pdf.destroy();
      });
    }).catch((err: unknown) => {
      if (live) setError(err instanceof Error ? err.message : "Unable to open this PDF.");
    });
    return () => {
      live = false;
      destroy();
    };
  }, [url]);

  useEffect(() => {
    const element = scrollRoot.current;
    if (!element) return;
    const updateWidth = () => setWidth(Math.max(0, element.clientWidth - 24));
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    updateWidth();
    return () => observer.disconnect();
  }, []);

  return <div className="pdf-pages" ref={scrollRoot}>
    {error ? <p className="pdf-message" role="alert">{error}</p> : !document ? <p className="pdf-message">Loading PDF…</p> : Array.from({ length: document.numPages }, (_, index) => (
      <PdfPage key={index + 1} document={document} number={index + 1} width={width} scrollRoot={scrollRoot.current} />
    ))}
  </div>;
}

function PdfPage({ document, number, width, scrollRoot }: { document: PDFDocumentProxy; number: number; width: number; scrollRoot: HTMLDivElement | null }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [ratio, setRatio] = useState(1.414);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let live = true;
    void document.getPage(number).then((loaded) => {
      if (!live) return;
      const viewport = loaded.getViewport({ scale: 1 });
      setRatio(viewport.height / viewport.width);
      setPage(loaded);
    });
    return () => { live = false; };
  }, [document, number]);

  useEffect(() => {
    const element = container.current;
    if (!element || !scrollRoot) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: scrollRoot,
      rootMargin: "800px 0px",
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    const element = canvas.current;
    if (!page || !element || !visible || width === 0) return;
    const cssWidth = Math.min(width, 900);
    const viewport = page.getViewport({ scale: cssWidth / page.getViewport({ scale: 1 }).width });
    const pixelRatio = window.devicePixelRatio || 1;
    const context = element.getContext("2d");
    if (!context) return;
    element.width = Math.ceil(viewport.width * pixelRatio);
    element.height = Math.ceil(viewport.height * pixelRatio);
    const task = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
    });
    void task.promise.catch((err: unknown) => {
      if (!(err instanceof Error) || err.name !== "RenderingCancelledException") return;
    });
    return () => {
      task.cancel();
      element.width = 0;
      element.height = 0;
    };
  }, [page, visible, width]);

  return <div className="pdf-page" ref={container} style={{ aspectRatio: `1 / ${ratio}` }}>
    <canvas ref={canvas} aria-label={`Page ${number}`} />
  </div>;
}
