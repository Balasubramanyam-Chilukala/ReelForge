import { useState } from "react";
import { useStore } from "../store.js";
import type { BridgeInfo } from "../bridge/client.js";

export function Settings() {
  const { status, connection, connect, refreshStatus } = useStore();
  const [port, setPort] = useState("");
  const [token, setToken] = useState("");

  const manualConnect = () => {
    if (!port || !token) return;
    const info: BridgeInfo = { port: Number(port), token };
    void connect(info);
  };

  return (
    <div className="home">
      <h1>Settings</h1>

      <div className="section">
        <h3 style={{ marginBottom: 12 }}>Backend connection</h3>
        <div className="insp-row"><label>Status</label><span className={`badge ${connection === "connected" ? "good" : "bad"}`}>{connection}</span></div>
        <div className="media-sub" style={{ marginBottom: 12 }}>
          In the desktop app the backend is detected automatically. For the browser dev server, paste the port & token the daemon prints, or launch with <span className="mono">?bridge=PORT:TOKEN</span>.
        </div>
        <div className="insp-row"><label>Port</label><input value={port} onChange={(e) => setPort(e.target.value)} placeholder="e.g. 51734" /></div>
        <div className="insp-row"><label>Token</label><input value={token} onChange={(e) => setToken(e.target.value)} /></div>
        <button onClick={manualConnect}>Connect</button>{" "}
        <button className="ghost" onClick={refreshStatus}>Refresh status</button>
      </div>

      <div className="section">
        <h3 style={{ marginBottom: 12 }}>FFmpeg</h3>
        <div className="insp-row"><label>ffmpeg</label><span className={`badge ${status?.ffmpeg.ffmpeg ? "good" : "bad"}`}>{status?.ffmpeg.ffmpegVersion ?? (status?.ffmpeg.ffmpeg ? "ready" : "not found")}</span></div>
        <div className="insp-row"><label>ffprobe</label><span className={`badge ${status?.ffmpeg.ffprobe ? "good" : "bad"}`}>{status?.ffmpeg.ffprobe ? "ready" : "not found"}</span></div>
        <div className="media-sub" style={{ marginTop: 8 }}>
          ReelForge uses a system or user-provided FFmpeg. Set <span className="mono">REELFORGE_FFMPEG</span> / <span className="mono">REELFORGE_FFPROBE</span> to point at specific binaries.
        </div>
      </div>

      <div className="section">
        <h3 style={{ marginBottom: 12 }}>About</h3>
        <div className="insp-row"><label>App</label><span>{status?.app ?? "ReelForge"} {status?.version ?? ""}</span></div>
        <div className="media-sub">Local-first. No account required. Projects live in your OS app-data directory.</div>
      </div>
    </div>
  );
}
