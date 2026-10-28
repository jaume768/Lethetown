import type { RashomonResponse } from "@lethetown/shared";
import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { api } from "../net/store";
import { formatGameTime } from "./format";
import { copyText, permalink } from "./links";
import { Modal } from "./Modal";

/** Dibuja la vista Rashomon en un PNG (columnas por agente) y lo descarga. */
function exportImage(
  data: RashomonResponse,
  t: (k: MessageKey, v?: Record<string, string | number>) => string,
) {
  const W = 1200;
  const colW = Math.floor((W - 48) / Math.max(1, data.accounts.length));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const wrap = (text: string, width: number, font: string) => {
    ctx.font = font;
    const lines: string[] = [];
    let line = "";
    for (const word of text.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const body = "16px 'Atkinson Hyperlegible', sans-serif";
  const blocks = data.accounts.map((acc) =>
    acc.memories.map((m) =>
      wrap(
        m.clarity === "vague" && m.memory.gist ? `… ${m.memory.gist}` : m.memory.text,
        colW - 32,
        body,
      ),
    ),
  );
  const colHeights = blocks.map((b) => b.reduce((h, lines) => h + lines.length * 22 + 18, 60));
  const header = data.event
    ? wrap(`${formatGameTime(data.event.time)} · ${data.event.text}`, W - 48, body)
    : [];
  canvas.width = W;
  canvas.height = Math.min(4000, 110 + header.length * 22 + Math.max(120, ...colHeights) + 50);
  ctx.fillStyle = "#1d2330";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = "#f0b84c";
  ctx.font = "bold 32px 'Pixelify Sans', monospace";
  ctx.fillText(`${t("rashomon.title")} · Lethetown`, 24, 48);
  ctx.fillStyle = "#f2ecdc";
  ctx.font = body;
  header.forEach((l, i) => ctx.fillText(l, 24, 80 + i * 22));
  const top = 100 + header.length * 22;
  data.accounts.forEach((acc, c) => {
    const x = 24 + c * colW;
    ctx.fillStyle = "#6fc3df";
    ctx.font = "bold 20px 'Pixelify Sans', monospace";
    ctx.fillText(t("rashomon.remembers", { name: acc.name }), x, top + 20);
    let y = top + 50;
    blocks[c]!.forEach((lines, i) => {
      const m = acc.memories[i]!;
      ctx.globalAlpha = 0.35 + 0.65 * m.strength;
      ctx.fillStyle = "#2a3142";
      ctx.fillRect(x, y - 16, colW - 16, lines.length * 22 + 10);
      ctx.fillStyle = "#f2ecdc";
      ctx.font = body;
      lines.forEach((l, j) => ctx.fillText(l, x + 8, y + j * 22));
      ctx.globalAlpha = 1;
      y += lines.length * 22 + 18;
    });
  });
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "bold 18px 'Pixelify Sans', monospace";
  ctx.fillText("lethetown.com", W - 170, canvas.height - 18);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lethetown-rashomon-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, "image/png");
}

/** Vista Rashomon: cómo recuerda un evento cada implicado y cómo ha cambiado su versión. */
export function RashomonModal({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<RashomonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<RashomonResponse>(`/api/rashomon/${encodeURIComponent(eventId)}`)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  return (
    <Modal
      title={t("rashomon.title")}
      onClose={onClose}
      actions={
        <>
          <button
            className="btn small"
            onClick={() =>
              void copyText(permalink({ event: eventId })).then((ok) => ok && setCopied(true))
            }
          >
            {copied ? t("dramas.copied") : t("rashomon.link")}
          </button>
          <button
            className="btn small"
            disabled={!data}
            onClick={() => data && exportImage(data, t)}
          >
            {t("rashomon.export")}
          </button>
        </>
      }
    >
      {data?.event && (
        <p className="readable">
          {formatGameTime(data.event.time)} · {data.event.text}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      {data && data.accounts.length === 0 && <p className="muted">{t("rashomon.none")}</p>}
      <div className="rashomon">
        {data?.accounts.map((acc) => (
          <div key={acc.agentId}>
            <h4>{t("rashomon.remembers", { name: acc.name })}</h4>
            <div className="garden">
              {acc.memories.map((m) => (
                <div
                  key={m.memory.id}
                  className={`card type-${m.memory.type} clarity-${m.clarity}`}
                  style={{ opacity: 0.3 + 0.7 * m.strength }}
                >
                  <div className="text readable">
                    {m.clarity === "vague" && m.memory.gist ? `… ${m.memory.gist}` : m.memory.text}
                  </div>
                  <div className="tags">
                    <span className="tag">{m.memory.source}</span>
                    <span className="tag">
                      {t("memory.strength", { value: m.strength.toFixed(2) })}
                    </span>
                    <span className="tag">{t(`memory.clarity.${m.clarity}` as MessageKey)}</span>
                  </div>
                  {m.versions.length > 0 && (
                    <ol className="versions readable">
                      {m.versions.map((v) => (
                        <li key={v.version}>
                          {formatGameTime(v.at)} · {t("rashomon.before")}: «{v.text}» ({v.source};{" "}
                          {v.reason})
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
