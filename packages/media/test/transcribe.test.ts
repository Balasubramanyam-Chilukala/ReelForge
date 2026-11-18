import { describe, expect, it } from "vitest";
import { ticksToSeconds } from "@reelforge/engine";
import { parseWhisperJson, parseGroqVerboseJson } from "../src/transcribe.js";
import { parseSilence } from "../src/silence.js";

describe("parseWhisperJson", () => {
  it("parses whisper.cpp -oj output into timed segments", () => {
    const json = {
      result: { language: "en" },
      transcription: [
        { offsets: { from: 0, to: 1500 }, text: " Hello there" },
        { offsets: { from: 1500, to: 3200 }, text: " general" },
        { offsets: { from: 3200, to: 3200 }, text: "   " }, // blank -> skipped
      ],
    };
    const t = parseWhisperJson(json);
    expect(t.language).toBe("en");
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0]!.text).toBe("Hello there");
    expect(ticksToSeconds(t.segments[0]!.endTick)).toBeCloseTo(1.5, 3);
    expect(ticksToSeconds(t.segments[1]!.startTick)).toBeCloseTo(1.5, 3);
  });

  it("tolerates missing fields", () => {
    expect(parseWhisperJson({}).segments).toEqual([]);
    expect(parseWhisperJson({ transcription: [{ text: "no offsets" }] }).segments).toEqual([]);
  });
});

describe("parseGroqVerboseJson", () => {
  it("parses Groq verbose_json segments and words", () => {
    const t = parseGroqVerboseJson({
      language: "english",
      segments: [{ start: 0, end: 2.0, text: " Hello world" }],
      words: [
        { word: "Hello", start: 0.0, end: 0.6 },
        { word: "world", start: 0.6, end: 2.0 },
      ],
    });
    expect(t.language).toBe("english");
    expect(t.segments).toHaveLength(1);
    expect(t.words).toHaveLength(2);
    expect(ticksToSeconds(t.words![1]!.startTick)).toBeCloseTo(0.6, 3);
    expect(t.words![0]!.text).toBe("Hello");
  });

  it("falls back to top-level text when no segments", () => {
    const t = parseGroqVerboseJson({ text: "just text", words: [{ word: "just", start: 0, end: 0.5 }] });
    expect(t.segments[0]!.text).toBe("just text");
  });
});

describe("parseSilence", () => {
  it("inverts silence intervals into speech segments", () => {
    const stderr = [
      "[silencedetect @ 0x1] silence_start: 2.0",
      "[silencedetect @ 0x1] silence_end: 3.5 | silence_duration: 1.5",
      "[silencedetect @ 0x1] silence_start: 8.0",
      "[silencedetect @ 0x1] silence_end: 9.0 | silence_duration: 1.0",
    ].join("\n");
    const speech = parseSilence(stderr, 10);
    // speech: [0,2], [3.5,8], [9,10]
    expect(speech).toHaveLength(3);
    expect(ticksToSeconds(speech[0]!.startTick)).toBeCloseTo(0, 3);
    expect(ticksToSeconds(speech[0]!.endTick)).toBeCloseTo(2, 3);
    expect(ticksToSeconds(speech[1]!.startTick)).toBeCloseTo(3.5, 3);
    expect(ticksToSeconds(speech[1]!.endTick)).toBeCloseTo(8, 3);
    expect(ticksToSeconds(speech[2]!.endTick)).toBeCloseTo(10, 3);
  });

  it("handles trailing silence with no silence_end", () => {
    const stderr = "silence_start: 4.0";
    const speech = parseSilence(stderr, 6);
    expect(speech).toHaveLength(1);
    expect(ticksToSeconds(speech[0]!.endTick)).toBeCloseTo(4, 3);
  });

  it("returns whole duration as speech when there is no silence", () => {
    const speech = parseSilence("", 5);
    expect(speech).toHaveLength(1);
    expect(ticksToSeconds(speech[0]!.endTick)).toBeCloseTo(5, 3);
  });
});
