/**
 * EditDocument: owns a project and an undo/redo history of invertible commands.
 * This is the single entry point the backend uses to mutate a project.
 */

import { execute, type Command, type CommandExec } from "./commands.js";
import type { ProjectDoc } from "./schema.js";

export interface ApplyResult {
  doc: ProjectDoc;
  created?: Record<string, string>;
  /** Command label for the activity log. */
  label: string;
}

export interface HistoryEntry {
  label: string;
  at: string;
}

export class EditDocument {
  private _doc: ProjectDoc;
  private undoStack: { inverse: Command; label: string }[] = [];
  private redoStack: { inverse: Command; label: string }[] = [];
  private readonly limit: number;

  constructor(doc: ProjectDoc, opts: { historyLimit?: number } = {}) {
    this._doc = doc;
    this.limit = opts.historyLimit ?? 200;
  }

  get doc(): ProjectDoc {
    return this._doc;
  }

  /** Apply a command, recording its inverse for undo and clearing the redo stack. */
  apply(cmd: Command): ApplyResult {
    const result: CommandExec = execute(this._doc, cmd);
    this._doc = result.doc;
    const label = commandLabel(cmd);
    this.undoStack.push({ inverse: result.inverse, label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
    return { doc: this._doc, created: result.created, label };
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): ApplyResult | undefined {
    const entry = this.undoStack.pop();
    if (!entry) return undefined;
    const result = execute(this._doc, entry.inverse);
    this._doc = result.doc;
    this.redoStack.push({ inverse: result.inverse, label: entry.label });
    return { doc: this._doc, label: `undo ${entry.label}` };
  }

  redo(): ApplyResult | undefined {
    const entry = this.redoStack.pop();
    if (!entry) return undefined;
    const result = execute(this._doc, entry.inverse);
    this._doc = result.doc;
    this.undoStack.push({ inverse: result.inverse, label: entry.label });
    return { doc: this._doc, label: `redo ${entry.label}` };
  }

  /** Replace the underlying doc (e.g. after load) and clear history. */
  reset(doc: ProjectDoc): void {
    this._doc = doc;
    this.undoStack = [];
    this.redoStack = [];
  }

  historyDepth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }
}

function commandLabel(cmd: Command): string {
  // Human-readable label for the activity log.
  const map: Record<string, string> = {
    renameProject: "Rename project",
    updateSettings: "Update settings",
    addMedia: "Import media",
    removeMedia: "Remove media",
    addTrack: "Add track",
    removeTrack: "Remove track",
    renameTrack: "Rename track",
    setTrackFlags: "Set track flags",
    setTrackDuck: "Set audio ducking",
    addClip: "Add clip",
    removeClip: "Remove clip",
    trimClip: "Trim clip",
    splitClip: "Split clip",
    moveClip: "Move clip",
    reorderClips: "Reorder clips",
    setClipSpeed: "Change speed",
    setClipFit: "Reframe clip",
    setClipTransform: "Transform clip",
    setClipColor: "Color adjust",
    setClipVolume: "Set volume",
    setClipFades: "Set fades",
    addTransition: "Add transition",
    addTextOverlay: "Add text",
    editText: "Edit text",
    applyEffect: "Apply effect",
  };
  return map[cmd.type] ?? cmd.type;
}
