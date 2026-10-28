import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { gameTimeNow } from "../net/store";
import { formatGameTime } from "./format";
import { Modal } from "./Modal";

const DURATIONS = [10, 20, 30] as const;
const OUT_W = 720;
const OUT_H = 1280;
const WATERMARK = "lethetown.com";

function pickMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const m of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

/**
 * "Crear clip": graba en vertical (9:16) el centro de la vista del mapa durante 10–30 s, con la
 * hora de juego y la marca de agua, y lo ofrece para descargar. Todo ocurre en el navegador.
 */
export function ClipRecorder({
  source,
  onClose,
}: {
  source: () => HTMLCanvasElement | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [duration, setDuration] = useState<(typeof DURATIONS)[number]>(10);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => {});
  const mime = pickMime();

  useEffect(() => () => stopRef.current(), []);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);

  const start = () => {
    const src = source();
    if (!src || !mime) return;
    const out = document.createElement("canvas");
    out.width = OUT_W;
    out.height = OUT_H;
    const ctx = out.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    const draw = () => {
      // Recorte vertical del centro de la vista, escalado a 720×1280.
      const cropH = src.height;
      const cropW = Math.min(src.width, Math.round((cropH * 9) / 16));
      const sx = Math.round((src.width - cropW) / 2);
      ctx.fillStyle = "#1d2330";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      const scale = Math.min(OUT_W / cropW, OUT_H / cropH);
      const dw = cropW * scale;
      const dh = cropH * scale;
      ctx.drawImage(src, sx, 0, cropW, cropH, (OUT_W - dw) / 2, (OUT_H - dh) / 2, dw, dh);
      ctx.fillStyle = "rgba(16,19,27,0.75)";
      ctx.fillRect(0, 0, OUT_W, 72);
      ctx.fillStyle = "#f0b84c";
      ctx.font = "bold 34px 'Pixelify Sans', monospace";
      ctx.fillText(formatGameTime(gameTimeNow()), 24, 48);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = "bold 30px 'Pixelify Sans', monospace";
      const w = ctx.measureText(WATERMARK).width;
      ctx.fillText(WATERMARK, OUT_W - w - 24, OUT_H - 32);
      raf = requestAnimationFrame(draw);
    };
    draw();
    const stream = out.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((tr) => tr.stop());
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
    setElapsed(0);
    rec.start(1000);
  };

  return (
    <Modal title={t("clip.title")} onClose={onClose} className="narrow">
      {!mime ? (
        <p className="error">{t("clip.unsupported")}</p>
      ) : (
        <>
          <p className="muted small">{t("clip.hint")}</p>
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
          <div className="row" style={{ marginTop: 8 }}>
            {elapsed === null ? (
              <button className="btn primary" onClick={start}>
                ⏺ {t("clip.start")}
              </button>
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
