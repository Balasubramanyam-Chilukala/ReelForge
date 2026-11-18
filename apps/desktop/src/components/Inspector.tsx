import { useStore } from "../store.js";
import { ticksToSeconds } from "../util.js";
import { DEFAULT_COLOR, DEFAULT_TRANSFORM, type Clip, type ProjectDoc } from "@reelforge/engine";

export function Inspector() {
  const { doc, selection } = useStore();
  if (!doc) return null;
  const clip = selection.clipId ? find(doc, selection.clipId) : undefined;

  return (
    <>
      <div className="panel-head">Inspector</div>
      {clip ? <ClipInspector clip={clip} /> : <ProjectInspector doc={doc} />}
      <div className="panel-head">Edit Activity</div>
      <ActivityFeed />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="insp-row"><label>{label}</label>{children}</div>;
}

function ClipInspector({ clip }: { clip: Clip }) {
  const apply = useStore((s) => s.apply);
  const t = clip.transform ?? DEFAULT_TRANSFORM;
  const c = clip.color ?? DEFAULT_COLOR;
  const dur = ticksToSeconds(clip.durationTick);

  const num = (v: string) => Number(v);
  return (
    <>
      <div className="insp-group">
        <div style={{ marginBottom: 8, fontWeight: 600 }}>{clip.kind} clip</div>
        <Row label="Duration"><span className="mono">{dur.toFixed(2)}s</span></Row>
        <Row label="Speed">
          <input type="number" step={0.25} min={0.1} value={clip.speed}
            onChange={(e) => apply({ type: "setClipSpeed", params: { clipId: clip.id, speed: num(e.target.value) || 1 } })} />
        </Row>
        {clip.kind !== "text" && (
          <Row label="Volume">
            <input type="range" min={0} max={2} step={0.05} value={clip.volume ?? 1}
              onChange={(e) => apply({ type: "setClipVolume", params: { clipId: clip.id, volume: num(e.target.value) } })} />
          </Row>
        )}
      </div>

      {clip.kind !== "text" && clip.kind !== "audio" && (
        <div className="insp-group">
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Transform</div>
          {(["scale", "rotation", "opacity"] as const).map((k) => (
            <Row key={k} label={k}>
              <input type="number" step={k === "opacity" ? 0.05 : k === "scale" ? 0.05 : 5} value={(t as never)[k]}
                onChange={(e) => apply({ type: "setClipTransform", params: { clipId: clip.id, patch: { [k]: num(e.target.value) } } })} />
            </Row>
          ))}
          <div style={{ marginBottom: 8, marginTop: 12, fontWeight: 600 }}>Color</div>
          {(["brightness", "contrast", "saturation"] as const).map((k) => (
            <Row key={k} label={k}>
              <input type="range" min={-1} max={1} step={0.05} value={(c as never)[k]}
                onChange={(e) => apply({ type: "setClipColor", params: { clipId: clip.id, patch: { [k]: num(e.target.value) } } })} />
            </Row>
          ))}
        </div>
      )}

      <div className="insp-group">
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Fades & Transition</div>
        <Row label="Fade in (s)">
          <input type="number" step={0.1} min={0} value={ticksToSeconds(clip.fades?.inTicks ?? 0)}
            onChange={(e) => apply({ type: "setClipFades", params: { clipId: clip.id, inTicks: Math.round(num(e.target.value) * 90000) } })} />
        </Row>
        <Row label="Fade out (s)">
          <input type="number" step={0.1} min={0} value={ticksToSeconds(clip.fades?.outTicks ?? 0)}
            onChange={(e) => apply({ type: "setClipFades", params: { clipId: clip.id, outTicks: Math.round(num(e.target.value) * 90000) } })} />
        </Row>
        <Row label="Transition">
          <select value={clip.transitionIn?.kind ?? ""}
            onChange={(e) => e.target.value && apply({ type: "addTransition", params: { clipId: clip.id, kind: e.target.value, durationTicks: Math.min(45000, Math.floor(clip.durationTick / 2)) } })}>
            <option value="">none</option>
            {["crossDissolve", "fadeToBlack", "fadeFromBlack", "zoom", "slide", "wipe", "blur"].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Row>
      </div>

      {clip.kind === "text" && clip.text && (
        <div className="insp-group">
          <div style={{ marginBottom: 8, fontWeight: 600 }}>Text</div>
          <Row label="Content">
            <input value={clip.text.text} onChange={(e) => apply({ type: "editText", params: { clipId: clip.id, text: e.target.value } })} />
          </Row>
          <Row label="Size">
            <input type="number" value={clip.text.style.fontSize} onChange={(e) => apply({ type: "editText", params: { clipId: clip.id, stylePatch: { fontSize: num(e.target.value) } } })} />
          </Row>
          <Row label="Color">
            <input type="color" value={clip.text.style.color} onChange={(e) => apply({ type: "editText", params: { clipId: clip.id, stylePatch: { color: e.target.value } } })} />
          </Row>
        </div>
      )}
    </>
  );
}

function ProjectInspector({ doc }: { doc: ProjectDoc }) {
  return (
    <div className="insp-group">
      <Row label="Project"><span>{doc.name}</span></Row>
      <Row label="Canvas"><span className="mono">{doc.settings.width}×{doc.settings.height}</span></Row>
      <Row label="FPS"><span className="mono">{doc.settings.fps}</span></Row>
      <Row label="Tracks"><span>{doc.timeline.tracks.length}</span></Row>
      <Row label="Media"><span>{doc.media.length}</span></Row>
      <div className="media-sub" style={{ marginTop: 10 }}>Select a clip to edit it. Double-click media to add it to the timeline.</div>
    </div>
  );
}

function ActivityFeed() {
  const activity = useStore((s) => s.activity);
  if (activity.length === 0) return <div className="empty">No edits yet.</div>;
  return (
    <div className="activity">
      {[...activity].slice(-80).reverse().map((a, i) => (
        <div className="row" key={i}>
          <span className={`src ${a.source}`}>{a.source}</span>
          <span style={{ flex: 1 }}>{a.label}</span>
          <span className="media-sub">{new Date(a.at).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}

function find(doc: ProjectDoc, clipId: string): Clip | undefined {
  for (const t of doc.timeline.tracks) {
    const c = t.clips.find((x) => x.id === clipId);
    if (c) return c;
  }
  return undefined;
}
