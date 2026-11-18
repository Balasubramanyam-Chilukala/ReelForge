import type { BridgeInfo } from "./client.js";

/** True when running inside the Tauri shell. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Discover the backend bridge. In the Tauri shell, a Rust command reads the state file and
 * returns {port, token}. In a plain browser (dev), fall back to a `?bridge=port:token`
 * query param or a value saved in localStorage, so the UI is usable without the shell.
 */
export async function getBridgeInfo(): Promise<BridgeInfo | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const info = (await invoke("get_bridge_info")) as BridgeInfo | null;
      if (info?.port && info.token) return info;
    } catch {
      /* fall through to browser fallbacks */
    }
  }
  const params = new URLSearchParams(window.location.search);
  const q = params.get("bridge");
  if (q && q.includes(":")) {
    const [port, token] = q.split(":");
    if (port && token) {
      const info = { port: Number(port), token };
      try {
        localStorage.setItem("reelforge.bridge", JSON.stringify(info));
      } catch {
        /* ignore */
      }
      return info;
    }
  }
  try {
    const saved = localStorage.getItem("reelforge.bridge");
    if (saved) return JSON.parse(saved) as BridgeInfo;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveBridgeInfo(info: BridgeInfo): void {
  try {
    localStorage.setItem("reelforge.bridge", JSON.stringify(info));
  } catch {
    /* ignore */
  }
}
