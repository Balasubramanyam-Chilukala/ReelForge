import { describe, expect, it } from "vitest";
import {
  TICK_RATE,
  framesToTicks,
  secondsToTicks,
  snapToFrame,
  ticksPerFrame,
  ticksToFrames,
  ticksToSeconds,
  formatTicks,
} from "../src/time.js";

describe("time model", () => {
  it("TICK_RATE represents integer fps exactly", () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      expect(Number.isInteger(TICK_RATE / fps)).toBe(true);
    }
  });

  it("29.97 fps has an integer ticks-per-frame (3003)", () => {
    expect(ticksPerFrame(30000 / 1001)).toBe(3003);
  });

  it("seconds round-trip", () => {
    expect(secondsToTicks(2)).toBe(180_000);
    expect(ticksToSeconds(180_000)).toBe(2);
  });

  it("frames convert without accumulating drift", () => {
    const fps = 30;
    let acc = 0;
    for (let f = 0; f < 10_000; f++) acc += framesToTicks(1, fps);
    // 10000 frames at 30fps = 333.333s. Absolute conversion is exact here.
    expect(framesToTicks(10_000, fps)).toBe(10_000 * 3000);
    expect(acc).toBe(10_000 * 3000);
  });

  it("ticksToFrames inverts framesToTicks", () => {
    expect(ticksToFrames(framesToTicks(90, 30), 30)).toBe(90);
  });

  it("snapToFrame snaps to nearest frame boundary", () => {
    const fps = 30; // 3000 ticks/frame
    expect(snapToFrame(4400, fps)).toBe(3000);
    expect(snapToFrame(4600, fps)).toBe(6000);
  });

  it("formats ticks as timecode", () => {
    expect(formatTicks(secondsToTicks(3661.5))).toBe("01:01:01.500");
  });
});
