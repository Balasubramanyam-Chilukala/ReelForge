import { useState } from "react";
import { useStore } from "../store.js";
import { humanDuration } from "../util.js";

export function Home() {
  const { projects, createProject, openProject, connection, connectionError, connect, status } = useStore();
  const [name, setName] = useState("My Reel");
  const [aspect, setAspect] = useState("9:16");
  const [fps, setFps] = useState(30);

  return (
    <div className="home">
      <h1>ReelForge</h1>
      <div className="sub">AI-first video editor for Reels, Shorts & TikToks — controllable by Claude Code and OpenCode.</div>

      {connection !== "connected" && (
        <div className="section" style={{ borderColor: "var(--bad)" }}>
          <strong>Backend {connection}.</strong> {connectionError}
          <div style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => connect()}>Retry connection</button>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="section form">
          <h3 style={{ marginBottom: 12 }}>New project</h3>
          <div className="insp-row"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="insp-row">
            <label>Aspect</label>
            <select value={aspect} onChange={(e) => setAspect(e.target.value)}>
              <option value="9:16">9:16 — Reels / Shorts / TikTok</option>
              <option value="16:9">16:9 — YouTube</option>
              <option value="1:1">1:1 — Square</option>
              <option value="4:5">4:5 — Instagram portrait</option>
            </select>
          </div>
          <div className="insp-row">
            <label>Frame rate</label>
            <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
              {[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
            </select>
          </div>
          <button className="primary" disabled={connection !== "connected"} onClick={() => createProject(name, aspect, fps)}>
            Create project
          </button>
        </div>

        <div className="section">
          <h3 style={{ marginBottom: 12 }}>Environment</h3>
          <div className="insp-row"><label>FFmpeg</label><span className={`badge ${status?.ffmpeg.ffmpeg ? "good" : "bad"}`}>{status?.ffmpeg.ffmpeg ? status.ffmpeg.ffmpegVersion ?? "ready" : "not found"}</span></div>
          <div className="insp-row"><label>FFprobe</label><span className={`badge ${status?.ffmpeg.ffprobe ? "good" : "bad"}`}>{status?.ffmpeg.ffprobe ? "ready" : "not found"}</span></div>
          <div className="insp-row"><label>Approval</label><span className="badge">{status?.approvalMode ?? "—"}</span></div>
          <div className="media-sub" style={{ marginTop: 8 }}>
            {status?.ffmpeg.ffmpeg ? "Media analysis and export are available." : "Install FFmpeg to enable import probing, preview and export."}
          </div>
        </div>
      </div>

      <h3 style={{ margin: "22px 0 12px" }}>Recent projects</h3>
      {projects.length === 0 ? (
        <div className="empty">No projects yet. Create one above.</div>
      ) : (
        <div className="cards">
          {projects.map((p) => (
            <div key={p.id} className="card" onClick={() => openProject(p.id)}>
              <h3>{p.name}</h3>
              <div className="meta">{p.trackCount} tracks · {p.mediaCount} media · {humanDuration(p.durationTicks)}</div>
              <div className="meta">Updated {new Date(p.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
