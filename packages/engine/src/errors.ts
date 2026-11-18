/** Typed engine errors so callers (backend/MCP) can map them to structured responses. */

export type EngineErrorCode =
  | "NOT_FOUND"
  | "INVALID_ARGUMENT"
  | "COLLISION"
  | "OUT_OF_BOUNDS"
  | "UNSUPPORTED"
  | "STATE";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: EngineErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "EngineError";
    this.code = code;
    this.details = details;
  }
}

export function notFound(what: string, id: string): EngineError {
  return new EngineError("NOT_FOUND", `${what} not found: ${id}`, { id });
}

export function invalid(message: string, details?: Record<string, unknown>): EngineError {
  return new EngineError("INVALID_ARGUMENT", message, details);
}
