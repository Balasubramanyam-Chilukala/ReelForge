import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { ticksToPx, pxToTicks, ticksToSeconds, trackColorVar } from "../util.js";
import { clipEnd, type Clip, type Track, type TrackKind } from "@reelforge/engine";

const HEAD = 96;

interface DragState {
  clipId: string;
  mode: "move" | "trim-l" | "trim-r";
  startX: number;
  origStart: number;
  origDur: number;
  deltaTicks: number;
}

export function Timeline() {
  const { doc, selection, select, apply, undo, redo, playheadTick, setPlayhead, pxPerSecond, setZoom } = useStore();
  const [drag, setDrag] = useState<DragState | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const deltaTicks = pxToTicks(e.clientX - drag.startX, pxPerSecond);
      setDrag({ ...drag, deltaTicks });
    };
    const onUp = async () => {
      const d = drag;
      setDrag(null);
      if (Math.abs(d.deltaTicks) < 1) return;
      try {
        if (d.mode === "move") {
          await apply({ type: "moveClip", params: { clipId: d.clipId, startTick: Math.max(0, d.origStart + d.deltaTicks) } });
        } else if (d.mode === "trim-l") {
          await apply({ type: "trimClip", params: { clipId: d.clipId, edge: "start", toTick: Math.max(0, d.origStart + d.deltaTicks) } });
        } else {
          await apply({ type: "trimClip", params: { clipId: d.clipId, edge: "end", toTick: d.origStart + d.origDur + d.deltaTicks } });
        }
      } catch (e) {
        // Collisions / bounds are surfaced; the model simply rejects the edit.
        console.warn((e as Error).message);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag, apply, pxPerSecond]);

  if (!doc) return null;
  const total = Math.max(doc.timeline.durationTicks, pxToTicks(600, pxPerSecond));
  const width = HEAD + ticksToPx(total, pxPerSecond) + 200;

  const startDrag = (e: React.PointerEvent, clip: Clip, mode: DragState["mode"]) => {
    e.stopPropagation();
    select({ clipId: clip.id });
    setDrag({ clipId: clip.id, mode, startX: e.clientX, origStart: clip.startTick, origDur: clip.durationTick, deltaTicks: 0 });
  };

  const scrub = (e: React.MouseEvent) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - HEAD + (areaRef.current?.scrollLeft ?? 0);
    setPlayhead(Math.max(0, pxToTicks(x, pxPerSecond)));
  };

  const selectedClip = selection.clipId ? findClip(doc.timeline.tracks, selection.clipId) : undefined;

  const splitSelected = () => {
    if (selectedClip && playheadTick > selectedClip.startTick && playheadTick < clipEnd(selectedClip)) {
      void apply({ type: "splitClip", params: { clipId: selectedClip.id, atTick: playheadTick } });
    }
  };
  const deleteSelected = () => {
    if (selection.clipId) void apply({ type: "removeClip", params: { clipId: selection.clipId } }).then(() => select({}));
  };
  const addTrack = (kind: TrackKind) => void apply({ type: "addTrack", params: { kind } });

  // Ruler seconds
  const secTotal = Math.ceil(ticksToSeconds(total));
  const stepSec = pxPerSecond < 30 ? 5 : pxPerSecond < 80 ? 2 : 1;

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <div className="toolbar-group">
          <button className="ghost" onClick={undo} title="Undo">↶</button>
          <button className="ghost" onClick={redo} title="Redo">↷</button>
        </div>
        <div className="toolbar-group">
          <button onClick={splitSelected} disabled={!selectedClip}>Split</button>
          <button onClick={deleteSelected} disabled={!selection.clipId}>Delete</button>
        </div>
        <div className="toolbar-group">
          <span className="media-sub">Add track:</span>
          {(["video", "audio", "text", "overlay"] as TrackKind[]).map((k) => (
            <button key={k} className="ghost" onClick={() => addTrack(k)}>{k}</button>
          ))}
        </div>
        <div className="spacer" />
        <div className="toolbar-group">
          <span className="media-sub">Zoom</span>
          <input type="range" min={12} max={300} value={pxPerSecond} style={{ width: 120 }} onChange={(e) => setZoom(Number(e.target.value))} />
        </div>
      </div>

      <div className="tracks" ref={areaRef} onMouseDown={(e) => { if ((e.target as HTMLElement).closest(".clip")) return; scrub(e); }}>
        <div style={{ width, position: "relative" }}>
          <div className="ruler" style={{ marginLeft: HEAD }}>
            {Array.from({ length: Math.ceil(secTotal / stepSec) + 1 }, (_, i) => i * stepSec).map((s) => (
              <div key={s} className="tick" style={{ left: ticksToPx(s * 90_000, pxPerSecond) }}>{s}s</div>
            ))}
          </div>

          {doc.timeline.tracks.map((track) => (
            <div className="track" key={track.id}>
              <div className="track-head">
                <strong>{track.name}</strong>
                <span className="media-sub">{track.kind}</span>
              </div>
              {track.clips.map((clip) => {
                const dragging = drag?.clipId === clip.id;
                let left = clip.startTick;
                let dur = clip.durationTick;
                if (dragging && drag) {
                  if (drag.mode === "move") left = Math.max(0, clip.startTick + drag.deltaTicks);
                  if (drag.mode === "trim-l") { left = Math.max(0, clip.startTick + drag.deltaTicks); dur = clipEnd(clip) - left; }
                  if (drag.mode === "trim-r") dur = Math.max(3000, clip.durationTick + drag.deltaTicks);
                }
                return (
                  <div
                    key={clip.id}
                    className={`clip${selection.clipId === clip.id ? " selected" : ""}`}
                    style={{
                      left: HEAD + ticksToPx(left, pxPerSecond),
                      width: Math.max(8, ticksToPx(dur, pxPerSecond)),
                      background: trackColorVar(track.kind),
                    }}
                    onPointerDown={(e) => startDrag(e, clip, "move")}
                    onClick={(e) => { e.stopPropagation(); select({ clipId: clip.id, trackId: track.id }); }}
                  >
                    <div className="handle l" onPointerDown={(e) => startDrag(e, clip, "trim-l")} />
                    <div className="label">{clipLabel(clip, doc)}</div>
                    <div className="handle r" onPointerDown={(e) => startDrag(e, clip, "trim-r")} />
                  </div>
                );
              })}
            </div>
          ))}

          <div className="playhead" style={{ left: HEAD + ticksToPx(playheadTick, pxPerSecond), height: "100%" }} />
        </div>
      </div>
    </div>
  );
}

function clipLabel(clip: Clip, doc: { media: { id: string; name: string }[] }): string {
  if (clip.kind === "text" && clip.text) return `“${clip.text.text}”`;
  const m = doc.media.find((x) => x.id === clip.mediaId);
  return (m?.name ?? clip.kind) + (clip.speed !== 1 ? ` ${clip.speed}×` : "");
}

function findClip(tracks: Track[], clipId: string): Clip | undefined {
  for (const t of tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) return c;
  }
  return undefined;
}
