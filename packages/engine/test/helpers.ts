import { createProject } from "../src/project.js";
import { createSeededIdGenerator, setIdGenerator } from "../src/ids.js";
import { setClock } from "../src/clock.js";
import { secondsToTicks, type Ticks } from "../src/time.js";
import { EditDocument } from "../src/document.js";
import type { MediaAsset, ProjectDoc } from "../src/schema.js";

/** Deterministic test environment: seeded ids + fixed clock. Returns a restore fn. */
export function deterministic(): () => void {
  const restoreIds = setIdGenerator(createSeededIdGenerator());
  const restoreClock = setClock(() => "2026-01-01T00:00:00.000Z");
  return () => {
    restoreIds();
    restoreClock();
  };
}

export function videoAsset(id: string, seconds = 10): MediaAsset {
  return {
    id,
    kind: "video",
    path: `/media/${id}.mp4`,
    name: `${id}.mp4`,
    importedAt: "2026-01-01T00:00:00.000Z",
    durationTicks: secondsToTicks(seconds),
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    probeStatus: "ready",
  };
}

/** A project with one 10s video asset already in the library. */
export function projectWithMedia(): { doc: EditDocument; mediaId: string; videoTrackId: string } {
  const project: ProjectDoc = createProject({ name: "Test", aspect: "9:16", fps: 30 });
  const doc = new EditDocument(project);
  const added = doc.apply({ type: "addMedia", params: { asset: videoAsset("v1") } });
  const mediaId = added.created!.mediaId!;
  const videoTrackId = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
  return { doc, mediaId, videoTrackId };
}

export const sec = (n: number): Ticks => secondsToTicks(n);
