import { useState } from "react";
import { useStore } from "../store.js";
import { humanDuration } from "../util.js";
import type { MediaAsset } from "@reelforge/engine";

const ICON: Record<string, string> = { video: "▶", image: "▤", audio: "♪" };

export function MediaLibrary() {
  const { doc, importMedia, apply, generateCaptions, autoRoughCut, autoReframe } = useStore();
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState("");

  const runAutoCut = async () => {
    if (!doc) return;
    const ids = doc.media.filter((m) => m.kind === "video").map((m) => m.id);
    if (!ids.length) return alert("Import some video first.");
    setAiBusy("cut");
    try {
      const r = await autoRoughCut(ids, 30, true);
      if (r) alert(`Auto rough cut added ${r.clipsAdded} clips.`);
    } catch (e) {
      alert(`Auto-cut failed: ${(e as Error).message}`);
    } finally {
      setAiBusy("");
    }
  };

  const runCaptions = async (mediaId: string) => {
    setAiBusy(mediaId);
    try {
      const r = await generateCaptions(mediaId, "wordHighlight", "word");
      if (r) alert(`Added ${r.added} word-by-word caption clips.`);
    } catch (e) {
      alert(`Captions need transcription. Set GROQ_API_KEY, or run setup_transcription (whisper.cpp). ${(e as Error).message}`);
    } finally {
      setAiBusy("");
    }
  };

  const runReframe = async () => {
    setAiBusy("reframe");
    try {
      const r = await autoReframe("cover");
      if (r) alert(`Reframed ${r.clips} clips to fill the frame.`);
    } catch (e) {
      alert(`Reframe failed: ${(e as Error).message}`);
    } finally {
      setAiBusy("");
    }
  };

  if (!doc) return null;
  const media = doc.media.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));

  const onImport = async () => {
    // Production builds open a native dialog via a Tauri command; this prompt fallback keeps
    // the panel functional in the browser dev server and when no dialog plugin is present.
    const path = window.prompt("Absolute path to media file (video/image/audio):");
    if (!path) return;
    setBusy(true);
    try {
      await importMedia(path);
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const addToTimeline = async (m: MediaAsset) => {
    const kind = m.kind;
    const wantTrackKind = kind === "audio" ? "audio" : kind === "image" ? "overlay" : "video";
    let track = doc.timeline.tracks.find((t) => t.kind === wantTrackKind);
    if (!track && wantTrackKind === "overlay") track = doc.timeline.tracks.find((t) => t.kind === "video");
    if (!track) {
      const created = await apply({ type: "addTrack", params: { kind: wantTrackKind } });
      track = { id: created!.trackId!, kind: wantTrackKind, name: "", index: 0, clips: [] } as never;
    }
    const duration = m.durationTicks ?? 90_000 * 3; // default 3s for stills/unprobed
    await apply({ type: "addClip", params: { trackId: track!.id, kind, mediaId: m.id, durationTick: duration } });
  };

  return (
    <>
      <div className="panel-head">
        Media Library
        <div className="spacer" />
        <button className="ghost" onClick={onImport} disabled={busy}>{busy ? "…" : "+ Import"}</button>
      </div>
      <div style={{ padding: 8, display: "flex", gap: 6 }}>
        <input placeholder="Search media…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="ghost" title="Auto rough cut from all video (removes silence)" onClick={runAutoCut} disabled={aiBusy !== ""}>
          {aiBusy === "cut" ? "…" : "Auto-cut"}
        </button>
        <button className="ghost" title="Reframe all clips to fill the frame (no black bars)" onClick={runReframe} disabled={aiBusy !== ""}>
          {aiBusy === "reframe" ? "…" : "Fill"}
        </button>
      </div>
      {media.length === 0 ? (
        <div className="empty">No media. Click “+ Import”.</div>
      ) : (
        media.map((m) => (
          <div key={m.id} className="media-item" title={m.path} onDoubleClick={() => addToTimeline(m)}>
            <div className="media-thumb">{ICON[m.kind] ?? "●"}</div>
            <div className="media-meta" style={{ flex: 1 }}>
              <div className="media-name">{m.name}</div>
              <div className="media-sub">
                {m.kind}
                {m.width ? ` · ${m.width}×${m.height}` : ""}
                {m.durationTicks ? ` · ${humanDuration(m.durationTicks)}` : ""}
                {m.probeStatus === "error" ? " · probe failed" : ""}
              </div>
            </div>
            <button className="ghost" onClick={() => addToTimeline(m)}>Add</button>
            {m.kind === "video" && (
              <button className="ghost" title="Auto-generate captions (whisper.cpp)" disabled={aiBusy !== ""} onClick={() => runCaptions(m.id)}>
                {aiBusy === m.id ? "…" : "CC"}
              </button>
            )}
          </div>
        ))
      )}
    </>
  );
}
