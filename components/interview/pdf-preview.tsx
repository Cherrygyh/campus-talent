'use client';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
const workerUrl = '/pdf.worker.min.mjs';
export default function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    let task: any;
    setBusy(true);
    setError('');
    (async () => {
      try {
        const pdf = await import('pdfjs-dist');
        pdf.GlobalWorkerOptions.workerSrc = workerUrl;
        const r = await fetch(url);
        if (!r.ok) throw new Error('材料读取失败');
        const bytes = await r.arrayBuffer();
        task = pdf.getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: '/pdf-cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdf-fonts/',
          useSystemFonts: true,
        });
        const document = await task.promise;
        if (!disposed) {
          setDoc(document);
          setPage(1);
        }
      } catch (e) {
        if (!disposed) {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    })();
    return () => {
      disposed = true;
      task?.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!doc) return;
    let disposed = false;
    let render: any;
    setBusy(true);
    (async () => {
      try {
        const p = await doc.getPage(page);
        if (disposed || !canvas.current) return;
        const base = p.getViewport({ scale: 1 });
        const container = canvas.current.parentElement;
        const scale =
          Math.min(1.6, Math.max(0.4, ((container?.clientWidth || 700) - 32) / base.width)) * zoom;
        const viewport = p.getViewport({ scale });
        const c = canvas.current;
        const ratio = window.devicePixelRatio || 1;
        c.width = viewport.width * ratio;
        c.height = viewport.height * ratio;
        c.style.width = viewport.width + 'px';
        c.style.height = viewport.height + 'px';
        render = p.render({
          canvas: c,
          canvasContext: c.getContext('2d')!,
          viewport,
          transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
        });
        await render.promise;
        if (!disposed) setBusy(false);
      } catch (e) {
        if (!disposed && (e as Error).name !== 'RenderingCancelledException') {
          setError((e as Error).message);
          setBusy(false);
        }
      }
    })();
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [doc, page, zoom]);
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button
          className="icon-btn"
          aria-label="PDF上一页"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={17} />
        </button>
        <span>
          {page} / {doc?.numPages || '—'} 页
        </span>
        <button
          className="icon-btn"
          aria-label="PDF下一页"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={17} />
        </button>
        <div />
        <button
          className="icon-btn"
          aria-label="缩小PDF"
          disabled={zoom <= 0.5}
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <ZoomOut size={16} />
        </button>
        <button
          className="icon-btn"
          aria-label="放大PDF"
          disabled={zoom >= 2}
          onClick={() => setZoom(Math.min(2, zoom + 0.25))}
        >
          <ZoomIn size={16} />
        </button>
      </div>
      <div className="pdf-canvas-wrap">
        {busy && (
          <div className="pdf-loading">
            <Loader2 className="spin" size={24} />
            <span>正在显示材料…</span>
          </div>
        )}
        {error ? (
          <div className="alert error">{error}，可在新窗口打开或下载原文件。</div>
        ) : (
          <canvas ref={canvas} />
        )}
      </div>
    </div>
  );
}
