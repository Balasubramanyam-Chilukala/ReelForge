import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { formatTicks, TICK_RATE } from "../util.js";
import { clipEnd } from "@reelforge/engine";

export function Preview() {
  const { doc, playheadTick, setPlayhead } = useStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 320, h: 180 });
  const [playing, setPlaying] = useState(false);

  const total = doc?.timeline.durationTicks ?? 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !doc) return;
    const fit = () => {
      const availW = el.clientWidth - 32;
      const availH = el.clientHeight - 32;
      const ar = doc.settings.width / doc.settings.height;
      let w = availW;
      let h = w / ar;
      if (h > availH) { h = availH; w = h * ar; }
      setBox({ w: Math.max(40, w), h: Math.max(40, h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const next = useStore.getState().playheadTick + Math.round(dt * TICK_RATE);
      if (next >= total) {
        setPlayhead(total);
        setPlaying(false);
        return;
      }
      setPlayhead(next);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, setPlayhead]);

  if (!doc) return null;
  const sx = box.w / doc.settings.width;

  // Approximate live preview: composite active clips at the playhead as DOM.
  const activeVisual = doc.timeline.tracks
    .filter((t) => t.kind === "video" || t.kind === "overlay" || t.kind === "text")
    .flatMap((t) => t.clips.map((c) => ({ c, t })))
    .filter(({ c }) => playheadTick >= c.startTick && playheadTick < clipEnd(c));

  return (
    <>
      <div className="center-toolbar">
        <div className="toolbar-group">
          <button className="ghost" onClick={() => setPlayhead(0)}>⏮</button>
          <button className="primary" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸ Pause" : "▶ Play"}</button>
          <button className="ghost" onClick={() => setPlayhead(total)}>⏭</button>
        </div>
        <div className="spacer" />
        <span className="mono" style={{ color: "var(--text-1)" }}>
          {formatTicks(playheadTick)} / {formatTicks(total)}
        </span>
        <div className="spacer" />
        <span className="badge">{doc.settings.width}×{doc.settings.height} · {doc.settings.fps}fps</span>
      </div>
      <div className="preview-wrap" ref={wrapRef}>
        <div className="preview-frame" style={{ width: box.w, height: box.h, background: doc.settings.background }}>
          {activeVisual.map(({ c }) => {
            if (c.kind === "text" && c.text) {
              return (
                <div key={c.id} style={{
                  position: "absolute",
                  left: `${c.text.anchor.x * 100}%`, top: `${c.text.anchor.y * 100}%`,
                  transform: "translate(-50%, -50%)",
                  color: c.text.style.color,
                  fontSize: c.text.style.fontSize * sx,
                  fontWeight: c.text.style.bold ? 800 : 600,
                  textShadow: c.text.style.shadow ? "0 2px 6px rgba(0,0,0,0.7)" : undefined,
                  WebkitTextStroke: c.text.style.outlineWidth ? `${c.text.style.outlineWidth * sx}px ${c.text.style.outlineColor ?? "#000"}` : undefined,
                  background: c.text.style.background ? `${c.text.style.background}aa` : undefined,
                  padding: c.text.style.background ? "0.1em 0.3em" : undefined,
                  whiteSpace: "nowrap",
                  textAlign: "center",
                }}>{c.text.text}</div>
              );
            }
            const media = doc.media.find((m) => m.id === c.mediaId);
            return (
              <div key={c.id} style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: c.transform?.opacity ?? 1,
                background: "repeating-linear-gradient(45deg,#1a1d24,#1a1d24 12px,#20242d 12px,#20242d 24px)",
                color: "var(--text-2)", fontSize: 12,
              }}>{media?.name ?? "clip"}</div>
            );
          })}
          {activeVisual.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)" }}>
              empty frame
            </div>
          )}
        </div>
      </div>
    </>
  );
}
