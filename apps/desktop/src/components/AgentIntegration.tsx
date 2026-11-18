import { useStore } from "../store.js";

const CLAUDE_SNIPPET = `// ~/.claude.json  (or run: reelforge-connect --agent claude)
{
  "mcpServers": {
    "reelforge": { "command": "reelforge-mcp", "args": [] }
  }
}`;

const OPENCODE_SNIPPET = `// ~/.config/opencode/opencode.json  (or: reelforge-connect --agent opencode)
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "reelforge": { "type": "local", "command": ["reelforge-mcp"], "enabled": true }
  }
}`;

export function AgentIntegration() {
  const { status, connection } = useStore();

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <div className="home">
      <h1>AI Agents</h1>
      <div className="sub">Let Claude Code or OpenCode edit your reels directly. Both use the same local <span className="mono">reelforge-mcp</span> server — one engine, no duplicated logic.</div>

      <div className="section">
        <h3 style={{ marginBottom: 12 }}>Status</h3>
        <div className="insp-row"><label>ReelForge backend</label><span className={`badge ${connection === "connected" ? "good" : "bad"}`}>{connection}</span></div>
        <div className="insp-row"><label>MCP bridge</label><span className={`badge ${connection === "connected" ? "good" : "bad"}`}>{connection === "connected" ? "reachable (127.0.0.1)" : "unreachable"}</span></div>
        <div className="insp-row"><label>FFmpeg</label><span className={`badge ${status?.ffmpeg.ffmpeg ? "good" : "bad"}`}>{status?.ffmpeg.ffmpeg ? "ready" : "not found"}</span></div>
        <div className="media-sub" style={{ marginTop: 8 }}>
          The MCP server discovers this running backend automatically via its state file — no token is stored in your agent config.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <AgentCard
          title="Claude Code"
          steps={[
            "Install Claude Code.",
            "Run: reelforge-connect --agent claude   (backs up & preserves your existing config).",
            "Restart Claude Code; ask it to open your project and create a reel.",
          ]}
          snippet={CLAUDE_SNIPPET}
          onCopy={() => copy(CLAUDE_SNIPPET)}
        />
        <AgentCard
          title="OpenCode"
          steps={[
            "Install OpenCode.",
            "Run: reelforge-connect --agent opencode",
            "Start OpenCode; it can use the identical ReelForge tools.",
          ]}
          snippet={OPENCODE_SNIPPET}
          onCopy={() => copy(OPENCODE_SNIPPET)}
        />
      </div>

      <div className="section">
        <h3 style={{ marginBottom: 8 }}>Try it</h3>
        <div className="media-sub">In your agent, say:</div>
        <pre className="mono" style={{ background: "var(--bg-0)", padding: 12, borderRadius: 6, whiteSpace: "pre-wrap" }}>
          “Open my latest ReelForge project, import the clips in C:\clips, build a 30-second
          reel of the best moments, add bold animated captions, synchronize cuts, and export
          to C:\out\reel.mp4.”
        </pre>
        <div className="media-sub">You’ll see each edit appear live in the ReelForge timeline and activity feed.</div>
      </div>

      <div className="section">
        <h3 style={{ marginBottom: 8 }}>REA (reference-analysis, developer-only)</h3>
        <div className="media-sub">REA (Reverse Engineer Anything) is an optional developer tool for studying reference apps. It is not required to run ReelForge. See <span className="mono">docs/AGENT_INTEGRATION.md</span> and <span className="mono">docs/REA.md</span>.</div>
      </div>
    </div>
  );
}

function AgentCard({ title, steps, snippet, onCopy }: { title: string; steps: string[]; snippet: string; onCopy: () => void }) {
  return (
    <div className="section">
      <h3 style={{ marginBottom: 10 }}>{title}</h3>
      <ol style={{ margin: "0 0 12px 18px", color: "var(--text-1)", lineHeight: 1.7 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div style={{ position: "relative" }}>
        <pre className="mono" style={{ background: "var(--bg-0)", padding: 12, borderRadius: 6, overflow: "auto", fontSize: 11 }}>{snippet}</pre>
        <button className="ghost" style={{ position: "absolute", top: 8, right: 8 }} onClick={onCopy}>Copy</button>
      </div>
    </div>
  );
}
