/**
 * Shared types for the execute-node handler registry.
 *
 * Each catalogueId (TR-001, GN-009, etc.) gets its own handler file in this
 * directory. The handlers are pure functions of NodeHandlerContext → Promise<...>.
 *
 * Return type is a UNION:
 *   • ExecutionArtifact   — happy path; the dispatcher wraps it in the success response
 *   • NextResponse        — early-return error response, sent verbatim by the dispatcher
 *
 * This preserves the original behaviour of every existing handler — including
 * handlers that returned NextResponse.json(...) directly inside the if/else
 * chain — without changing any business logic.
 */

import type { NextResponse } from "next/server";
import type { ExecutionArtifact } from "@/types/execution";

export type UserRoleStr =
  | "FREE"
  | "MINI"
  | "STARTER"
  | "PRO"
  | "TEAM_ADMIN"
  | "PLATFORM_ADMIN";

export interface NodeHandlerContext {
  // From the request body
  catalogueId: string;
  executionId: string;
  tileInstanceId: string;
  /**
   * Untyped because the original execute-node/route.ts dispatcher destructured
   * `req.json()` directly, which gives `any` for every field. Many handlers
   * rely on the wider type to assign loose objects to `BuildingDescription` and
   * similar shapes via implicit narrowing — switching to `Record<string, unknown>`
   * here would surface latent type errors the original code never had to face.
   * Decomposition preserves behaviour, so we mirror the original `any`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputData: any;

  // From the auth session
  userId: string;
  userRole: UserRoleStr;
  userEmail: string;
  isAdmin: boolean;

  // From the request body (optional override)
  apiKey: string | undefined;
}

export type NodeHandlerResult = ExecutionArtifact | NextResponse;

export type NodeHandler = (ctx: NodeHandlerContext) => Promise<NodeHandlerResult>;
