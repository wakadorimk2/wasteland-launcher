import { appendFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

export interface ResolveTraceEvent {
  t: number;
  event: "enter" | "leave" | "warn" | "skip";
  phase: string;
  elapsedMs?: number;
  file?: string;
  groupId?: string;
  opId?: string;
  opType?: string;
  modName?: string;
  xpath?: string;
  xpathHash?: string;
  xpathKind?: string;
  targetCount?: number;
  fileOperationCount?: number;
  candidateOperationCount?: number;
  reason?: string;
}

export class ResolveTracer {
  constructor(private readonly tracePath?: string) {
    if (tracePath) {
      writeFileSync(tracePath, "", "utf8");
    }
  }

  enabled(): boolean {
    return Boolean(this.tracePath);
  }

  enter(meta: Omit<ResolveTraceEvent, "t" | "event">): number {
    const t = performance.now();
    this.write({ t, event: "enter", ...meta });
    return t;
  }

  leave(start: number, meta: Omit<ResolveTraceEvent, "t" | "event" | "elapsedMs">): void {
    const now = performance.now();
    this.write({ t: now, event: "leave", elapsedMs: now - start, ...meta });
  }

  warn(meta: Omit<ResolveTraceEvent, "t" | "event">): void {
    this.write({ t: performance.now(), event: "warn", ...meta });
  }

  skip(meta: Omit<ResolveTraceEvent, "t" | "event">): void {
    this.write({ t: performance.now(), event: "skip", ...meta });
  }

  private write(event: ResolveTraceEvent): void {
    if (!this.tracePath) return;
    appendFileSync(this.tracePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

export function hashXPath(xpathText: string): string {
  return createHash("sha1").update(xpathText).digest("hex").slice(0, 12);
}

export function shortXPath(xpathText: string, max = 240): string {
  return xpathText.length <= max ? xpathText : `${xpathText.slice(0, max)}...`;
}
