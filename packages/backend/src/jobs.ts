/**
 * Minimal in-process job queue for long-running work (export/analyze). Serializes jobs,
 * reports progress, and supports cancellation via AbortController.
 */

import { randomUUID } from "node:crypto";
import type { JobKind, JobState } from "@reelforge/shared";

export interface JobContext {
  signal: AbortSignal;
  report: (progress: number) => void;
}

type JobRunner = (ctx: JobContext) => Promise<unknown>;

export class JobQueue {
  private jobs = new Map<string, JobState>();
  private controllers = new Map<string, AbortController>();
  private queue: string[] = [];
  private running = false;
  private runners = new Map<string, JobRunner>();

  constructor(private onChange: (job: JobState) => void) {}

  enqueue(kind: JobKind, projectId: string | undefined, runner: JobRunner): string {
    const id = `job_${randomUUID()}`;
    const job: JobState = { id, kind, status: "queued", progress: 0, projectId };
    this.jobs.set(id, job);
    this.runners.set(id, runner);
    this.queue.push(id);
    this.onChange(job);
    void this.pump();
    return id;
  }

  get(id: string): JobState | undefined {
    return this.jobs.get(id);
  }

  list(): JobState[] {
    return [...this.jobs.values()];
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (job.status === "queued") {
      this.queue = this.queue.filter((q) => q !== id);
      this.update(id, { status: "cancelled", finishedAt: new Date().toISOString() });
      return true;
    }
    if (job.status === "running") {
      this.controllers.get(id)?.abort();
      return true;
    }
    return false;
  }

  private update(id: string, patch: Partial<JobState>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    this.onChange(job);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const id = this.queue.shift()!;
        const runner = this.runners.get(id);
        const job = this.jobs.get(id);
        if (!runner || !job || job.status === "cancelled") continue;
        const controller = new AbortController();
        this.controllers.set(id, controller);
        this.update(id, { status: "running", startedAt: new Date().toISOString(), progress: 0 });
        try {
          const result = await runner({
            signal: controller.signal,
            report: (p) => this.update(id, { progress: Math.max(0, Math.min(1, p)) }),
          });
          this.update(id, {
            status: "done",
            progress: 1,
            result,
            finishedAt: new Date().toISOString(),
          });
        } catch (err) {
          const cancelled = controller.signal.aborted;
          this.update(id, {
            status: cancelled ? "cancelled" : "error",
            error: cancelled ? "cancelled" : (err as Error).message,
            finishedAt: new Date().toISOString(),
          });
        } finally {
          this.controllers.delete(id);
          this.runners.delete(id);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
