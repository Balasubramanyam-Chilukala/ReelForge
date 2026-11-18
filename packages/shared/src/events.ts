/** Server-pushed events over the WebSocket channel. */

import type { ProjectDoc } from "@reelforge/engine";
import type { ActivityEntry, JobState } from "./protocol.js";

export type BridgeEvent =
  | { type: "project.updated"; projectId: string; doc: ProjectDoc; label: string; source: string }
  | { type: "activity"; projectId: string; entry: ActivityEntry }
  | { type: "job.progress"; job: JobState }
  | { type: "job.done"; job: JobState }
  | { type: "hello"; app: string; version: string };
