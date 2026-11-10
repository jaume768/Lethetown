import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { gameTimeNow } from "../net/store";
import { FORMAT_SIZE, type ClipFormat } from "./cine";
import { formatGameTime } from "./format";
import { Modal } from "./Modal";

const DURATIONS = [10, 20, 30, 60] as const;
const FPS = 30;
const WATERMARK = "lethetown.com";

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

interface Props {
  source: () => HTMLCanvasElement | null;
  onClose: () => void;
  /** Formatos que se ofrecen (el primero, por defecto). */
  formats?: readonly ClipFormat[];
  /**
   * Lo que se dibuja encima en cada frame (subtítulos, marca); sin él, la hora y la marca de
   * agua de siempre.
   */
  overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number, format: ClipFormat) => void;
  /**
   * Grabar la pestaña (lo que se ve, con tarjetas y paneles) recortada a este rectángulo de la
   * ventana: para lo que no está en el lienzo del mapa.
   */
  tabRect?: () => DOMRect | null;
}

/**
 * "Crear clip": graba el centro de la vista del mapa durante 10–60 s a 30 fps, en el formato
 * elegido (9:16, 4:5 o 16:9), con la marca, y lo ofrece para descargar. Todo en el navegador.
 */
export function ClipRecorder({ source, onClose, formats = ["9:16"], overlay, tabRect }: Props) {
  const { t } = useI18n();
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(10);
  const [format, setFormat] = useState<ClipFormat>(formats[0] ?? "9:16");
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const mime = pickMime();

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  /** Graba lo que pinte `draw` en un lienzo del tamaño del formato. */
  const record = (draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => {
    if (!mime) return;
    const { w: OUT_W, h: OUT_H } = FORMAT_SIZE[format];
    const out = document.createElement("canvas");
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const loop = () => {
      draw(ctx, OUT_W, OUT_H);
      raf = requestAnimationFrame(loop);
    };
    loop();
    const stream = out.captureStream(FPS);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    let cleanup = () => {};
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
      cleanup();
      setUrl(URL.createObjectURL(new Blob(chunks, { type: mime })));
      setElapsed(null);
    };
    const t0 = performance.now();
    const tick = setInterval(() => {
      const s = Math.floor((performance.now() - t0) / 1000);
      setElapsed(s);
      if (s >= duration) stop();
    }, 250);
    const stop = () => {
      clearInterval(tick);
      if (rec.state !== "inactive") rec.stop();
    };
    stopRef.current = stop;
    setUrl(null);
    setError(null);
    setElapsed(0);
    rec.start(1000);
    return (fn: () => void) => (cleanup = fn);
  };

  const startCanvas = () => {
    if (!source()) return;
    const ratio = FORMAT_SIZE[format].w / FORMAT_SIZE[format].h;
    record((ctx, W, H) => {
      const src = source();
      ctx.fillStyle = "#1d2330";
      ctx.fillRect(0, 0, W, H);
      if (src) {
        // Recorte del centro de la vista con la proporción del formato.
        let cropW = src.width;
        let cropH = Math.round(cropW / ratio);
        if (cropH > src.height) {
          cropH = src.height;
          cropW = Math.round(cropH * ratio);
        }
        const sx = Math.round((src.width - cropW) / 2);
        const sy = Math.round((src.height - cropH) / 2);
        ctx.drawImage(src, sx, sy, cropW, cropH, 0, 0, W, H);
      }
      if (overlay) return overlay(ctx, W, H, format);
      ctx.fillStyle = "rgba(16,19,27,0.75)";
      ctx.fillRect(0, 0, W, Math.round(H * 0.056));
      ctx.fillStyle = "#f0b84c";
      ctx.font = `bold ${Math.round(H * 0.027)}px 'Pixelify Sans', monospace`;
      ctx.fillText(formatGameTime(gameTimeNow()), W * 0.033, H * 0.038);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `bold ${Math.round(H * 0.023)}px 'Pixelify Sans', monospace`;
      const mw = ctx.measureText(WATERMARK).width;
      ctx.fillText(WATERMARK, W - mw - W * 0.033, H - H * 0.025);
    });
  };

  /** La pestaña entera (con las tarjetas), recortada al marco. */
  const startTab = async () => {
    const md = navigator.mediaDevices as MediaDevices | undefined;
    if (!md?.getDisplayMedia) return setError(t("clip.tabUnsupported"));
    let media: MediaStream;
    try {
      media = await md.getDisplayMedia({
        video: { frameRate: FPS },
        audio: false,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
    } catch {
      return setError(t("clip.tabDenied"));
    }
    const video = document.createElement("video");
    video.srcObject = media;
    video.muted = true;
    await video.play();
    const onCleanup = record((ctx, W, H) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      const r = tabRect?.();
      if (!r || !video.videoWidth) return;
      // De píxeles de la ventana a píxeles del vídeo capturado.
      const k = video.videoWidth / window.innerWidth;
      ctx.drawImage(video, r.x * k, r.y * k, r.width * k, r.height * k, 0, 0, W, H);
    });
    onCleanup?.(() => media.getTracks().forEach((tr) => tr.stop()));
  };

  return (
    <Modal title={t("clip.title")} onClose={onClose} className="narrow">
      {!mime ? (
        <p className="error">{t("clip.unsupported")}</p>
      ) : (
        <>
          <p className="muted small">
            {formats.length > 1 ? t("clip.hintFormats") : t("clip.hint")}
          </p>
          {formats.length > 1 && (
            <div className="wrap" role="group" aria-label={t("clip.format")}>
              {formats.map((f) => (
                <button
                  key={f}
                  className={`btn small ${format === f ? "active" : ""}`}
                  aria-pressed={format === f}
                  disabled={elapsed !== null}
                  onClick={() => setFormat(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          <div className="wrap" role="group" aria-label={t("clip.duration")}>
            {DURATIONS.map((d) => (
              <button
                key={d}
                className={`btn small ${duration === d ? "active" : ""}`}
                aria-pressed={duration === d}
                disabled={elapsed !== null}
                onClick={() => setDuration(d)}
              >
                {t("clip.seconds", { n: d })}
              </button>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            {elapsed === null ? (
              <>
                <button className="btn primary" onClick={startCanvas}>
                  ⏺ {t("clip.start")}
                </button>
                {tabRect && (
                  <button className="btn" onClick={() => void startTab()}>
                    ⏺ {t("clip.tab")}
                  </button>
                )}
              </>
            ) : (
              <>
                <span role="status" aria-live="polite">
                  {t("clip.recording", { n: elapsed })}
                </span>
                <button className="btn" onClick={() => stopRef.current()}>
                  {t("clip.stop")}
                </button>
              </>
            )}
          </div>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          {url && (
            <div className="clip-result">
              <video src={url} controls playsInline className="clip-preview" />
              <a className="btn primary" href={url} download={`lethetown-clip-${Date.now()}.webm`}>
                {t("clip.download")}
              </a>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
