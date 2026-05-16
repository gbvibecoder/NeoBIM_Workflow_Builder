/**
 * BriefToIfcV3Run status state-machine (Phase v3 observability §D2).
 *
 * The ONLY sanctioned way to write the `status` column on a
 * `BriefToIfcV3Run` row. Every other call site goes through
 * `transitionStatus(...)` so:
 *
 *   1. Invalid transitions raise `InvalidStatusTransitionError` rather
 *      than silently writing nonsense (e.g. COMPLETED -> RUNNING).
 *   2. A terminal-status payload invariant is enforced:
 *        - COMPLETED ⇒ result fields non-null, errorCode null
 *        - FAILED    ⇒ errorCode set, result fields null
 *        - CANCELLED ⇒ errorCode = CANCELLED_BY_USER
 *   3. `completedAt` is set automatically when transitioning to any
 *      terminal status.
 *   4. The error code (if any) is validated against the closed
 *      `BriefToIfcV3ErrorCode` set — typo'd codes get rejected.
 *
 * Concurrent writes are guarded with an atomic `updateMany` filtered
 * on the current status — `count === 0` means a racing writer already
 * advanced the row (e.g. heartbeat-sweep marked it FAILED). The caller
 * gets `TransitionRaceLost` and chooses how to react.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  isBriefToIfcV3ErrorCode,
  type BriefToIfcV3ErrorCode,
} from "./error-codes";

/** Mirrors the Prisma `BriefToIfcV3RunStatus` enum exactly. */
export type BriefToIfcV3RunStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

const TERMINAL_STATUSES = new Set<BriefToIfcV3RunStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/** The full transition table. Each key is the `from` state; the value
 *  is the set of `to` states reachable from it. */
const VALID_TRANSITIONS: Record<
  BriefToIfcV3RunStatus,
  ReadonlySet<BriefToIfcV3RunStatus>
> = {
  PENDING: new Set(["RUNNING", "FAILED", "CANCELLED"]),
  RUNNING: new Set(["COMPLETED", "FAILED", "CANCELLED"]),
  COMPLETED: new Set([]), // terminal — no transitions out
  FAILED: new Set([]),    // terminal
  CANCELLED: new Set([]), // terminal
};

export function isTerminal(status: BriefToIfcV3RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isValidTransition(
  from: BriefToIfcV3RunStatus,
  to: BriefToIfcV3RunStatus,
): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

export class InvalidStatusTransitionError extends Error {
  readonly code = "INVALID_STATUS_TRANSITION";
  constructor(
    public readonly from: BriefToIfcV3RunStatus,
    public readonly to: BriefToIfcV3RunStatus,
    public readonly runId: string,
  ) {
    super(
      `BriefToIfcV3Run ${runId}: ${from} -> ${to} is not a valid transition. ` +
        `Valid targets from ${from}: ${
          [...VALID_TRANSITIONS[from]].join(", ") || "(none — terminal)"
        }`,
    );
    this.name = "InvalidStatusTransitionError";
  }
}

export class TransitionRaceLostError extends Error {
  readonly code = "TRANSITION_RACE_LOST";
  constructor(
    public readonly runId: string,
    public readonly expectedFrom: BriefToIfcV3RunStatus,
  ) {
    super(
      `BriefToIfcV3Run ${runId}: another writer advanced the row before ` +
        `this transition could land (expected from=${expectedFrom}).`,
    );
    this.name = "TransitionRaceLostError";
  }
}

export class InvariantViolationError extends Error {
  readonly code = "INVARIANT_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

/** Successful-terminal payload — required when transitioning to COMPLETED. */
export interface CompletedPayload {
  ifcUrl: string;
  entityCount: number;
  finalValidation?: unknown;
  generatorCostUsd?: number;
  generatorMs?: number;
  turns?: number;
  ledger?: unknown;
  turnRecords?: unknown;
}

/** Failed-terminal payload — required when transitioning to FAILED. */
export interface FailedPayload {
  errorCode: BriefToIfcV3ErrorCode;
  errorMessage: string;
  generatorCostUsd?: number;
  generatorMs?: number;
  turns?: number;
  ledger?: unknown;
  turnRecords?: unknown;
}

/** Cancelled-terminal payload — code is always CANCELLED_BY_USER. */
export interface CancelledPayload {
  errorMessage?: string;
}

export type TransitionPayload =
  | { to: "RUNNING"; startedAt?: Date }
  | { to: "COMPLETED"; payload: CompletedPayload }
  | { to: "FAILED"; payload: FailedPayload }
  | { to: "CANCELLED"; payload?: CancelledPayload };

/**
 * Atomically transition a run's status.
 *
 * Returns the new status on success. On failure throws one of the typed
 * errors above so the caller can pick a recovery path (retry, abort,
 * surface to user).
 */
export async function transitionStatus(
  prisma: PrismaClient,
  runId: string,
  from: BriefToIfcV3RunStatus,
  transition: TransitionPayload,
): Promise<BriefToIfcV3RunStatus> {
  const to = transition.to;

  // 1. Static state-machine check — refuse impossible transitions.
  if (!isValidTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to, runId);
  }

  // 2. Build the atomic update payload. The data shape varies by `to`
  //    because each terminal status has different invariants.
  const now = new Date();
  let data: Prisma.BriefToIfcV3RunUncheckedUpdateInput;

  if (to === "RUNNING") {
    data = {
      status: "RUNNING",
      startedAt: transition.startedAt ?? now,
      lastHeartbeatAt: now,
    };
  } else if (to === "COMPLETED") {
    const p = transition.payload;
    if (typeof p.ifcUrl !== "string" || p.ifcUrl.length === 0) {
      throw new InvariantViolationError(
        `transition to COMPLETED requires ifcUrl (got ${typeof p.ifcUrl})`,
      );
    }
    if (typeof p.entityCount !== "number" || p.entityCount < 0) {
      throw new InvariantViolationError(
        `transition to COMPLETED requires entityCount >= 0 (got ${p.entityCount})`,
      );
    }
    data = {
      status: "COMPLETED",
      ifcUrl: p.ifcUrl,
      entityCount: p.entityCount,
      finalValidation:
        p.finalValidation === undefined
          ? undefined
          : (p.finalValidation as Prisma.InputJsonValue),
      generatorCostUsd: p.generatorCostUsd,
      generatorMs: p.generatorMs,
      turns: p.turns,
      ledger:
        p.ledger === undefined ? undefined : (p.ledger as Prisma.InputJsonValue),
      turnRecords:
        p.turnRecords === undefined
          ? undefined
          : (p.turnRecords as Prisma.InputJsonValue),
      // Clear failure fields — invariant: COMPLETED rows have no error.
      errorCode: null,
      errorMessage: null,
      completedAt: now,
      lastHeartbeatAt: now,
    };
  } else if (to === "FAILED") {
    const p = transition.payload;
    if (!isBriefToIfcV3ErrorCode(p.errorCode)) {
      throw new InvariantViolationError(
        `transition to FAILED requires a known errorCode (got "${p.errorCode}"). ` +
          "Add the code to BRIEF_TO_IFC_V3_ERROR_CODES first.",
      );
    }
    if (typeof p.errorMessage !== "string") {
      throw new InvariantViolationError(
        `transition to FAILED requires errorMessage`,
      );
    }
    data = {
      status: "FAILED",
      errorCode: p.errorCode,
      errorMessage: p.errorMessage,
      generatorCostUsd: p.generatorCostUsd,
      generatorMs: p.generatorMs,
      turns: p.turns,
      ledger:
        p.ledger === undefined ? undefined : (p.ledger as Prisma.InputJsonValue),
      turnRecords:
        p.turnRecords === undefined
          ? undefined
          : (p.turnRecords as Prisma.InputJsonValue),
      // Clear success fields — invariant: FAILED rows have no ifc.
      ifcUrl: null,
      entityCount: null,
      completedAt: now,
    };
  } else {
    // CANCELLED
    const p = transition.payload ?? {};
    data = {
      status: "CANCELLED",
      errorCode: "CANCELLED_BY_USER",
      errorMessage: p.errorMessage ?? "Cancelled by user.",
      completedAt: now,
    };
  }

  // 3. Atomic conditional update. `updateMany` filtered on `id + status`
  //    so a concurrent transition (e.g. the stuck-sweep marking FAILED)
  //    can't be silently overwritten.
  const result = await prisma.briefToIfcV3Run.updateMany({
    where: { id: runId, status: from },
    data,
  });

  if (result.count === 0) {
    throw new TransitionRaceLostError(runId, from);
  }

  return to;
}
