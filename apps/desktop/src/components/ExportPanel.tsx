import { useState } from "react";
import { useStore } from "../store.js";
import { humanDuration, humanSize } from "../util.js";

export function ExportPanel() {
  const { doc, jobs, startExport, status } = useStore();
  const [outputPath, setOutputPath] = useState("");
  const [preset, setPreset] = useState("medium");
  const [crf, setCrf] = useState(20);
  const [overwrite, setOverwrite] = useState(false);
  const [loudness, setLoudness] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<string | null>(null);

  if (!doc) return null;
  const job = jobs.find((j) => j.id === activeJob);
  const ffmpegReady = status?.ffmpeg.ffmpeg;

  const onExport = async () => {
    setError(null);
    if (!outputPath.trim()) { setError("Choose an output path (e.g. C:\\Users\\you\\reel.mp4)."); return; }
    try {
      const id = await startExport(outputPath, { crf, preset }, overwrite, loudness);
      setActiveJob(id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="home">
      <h1>Export</h1>
      <div className="sub">Render “{doc.name}” to an MP4 (H.264 / AAC). Output is validated with FFprobe before being reported as done.</div>

      {!ffmpegReady && <div className="section" style={{ borderColor: "var(--warn)" }}>FFmpeg is not available — export is disabled. Install FFmpeg (see Settings).</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="section form">
          <h3 style={{ marginBottom: 12 }}>Settings</h3>
          <div className="insp-row"><label>Canvas</label><span className="mono">{doc.settings.width}×{doc.settings.height} · {doc.settings.aspect}</span></div>
          <div className="insp-row"><label>Frame rate</label><span className="mono">{doc.settings.fps} fps</span></div>
          <div className="insp-row">
            <label>Quality (CRF)</label>
            <input type="number" min={14} max={34} value={crf} onChange={(e) => setCrf(Number(e.target.value))} />
          </div>
          <div className="insp-row">
            <label>Preset</label>
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {["ultrafast", "veryfast", "fast", "medium", "slow"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div className="insp-row"><label>Output path</label><input value={outputPath} placeholder="C:\\Users\\you\\reel.mp4" onChange={(e) => setOutputPath(e.target.value)} /></div>
          <div className="insp-row"><label>Normalize loudness</label><input type="checkbox" checked={loudness} onChange={(e) => setLoudness(e.target.checked)} style={{ width: "auto" }} title="-14 LUFS for Reels/TikTok/Shorts" /></div>
          <div className="insp-row"><label>Overwrite</label><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} style={{ width: "auto" }} /></div>
          <button className="primary" disabled={!ffmpegReady} onClick={onExport}>Export video</button>
          {error && <div style={{ color: "var(--bad)", marginTop: 10 }}>{error}</div>}
        </div>

        <div className="section">
          <h3 style={{ marginBottom: 12 }}>Progress</h3>
          {!job ? (
            <div className="empty">No export running.</div>
          ) : (
            <>
              <div className="insp-row"><label>Status</label><span className={`badge ${job.status === "done" ? "good" : job.status === "error" ? "bad" : ""}`}>{job.status}</span></div>
              <div className="progress" style={{ margin: "8px 0" }}><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
              {job.status === "error" && <div style={{ color: "var(--bad)" }}>{job.error}</div>}
              {job.status === "done" && job.result != null && <ExportResult result={job.result as never} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ExportResult({ result }: { result: { outputPath: string; width: number; height: number; durationSec: number; sizeBytes: number; codecVideo?: string; hasAudio: boolean } }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="badge good">Exported & validated</div>
      <div className="insp-row" style={{ marginTop: 10 }}><label>File</label><span className="mono" style={{ wordBreak: "break-all" }}>{result.outputPath}</span></div>
      <div className="insp-row"><label>Resolution</label><span className="mono">{result.width}×{result.height}</span></div>
      <div className="insp-row"><label>Duration</label><span className="mono">{humanDuration(result.durationSec * 90000)}</span></div>
      <div className="insp-row"><label>Codec</label><span className="mono">{result.codecVideo}{result.hasAudio ? " + aac" : ""}</span></div>
      <div className="insp-row"><label>Size</label><span className="mono">{humanSize(result.sizeBytes)}</span></div>
    </div>
  );
}
