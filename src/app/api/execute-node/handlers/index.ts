/**
 * Node handler registry.
 *
 * Maps each catalogueId to the function that executes that node. The main
 * route handler is now a thin dispatcher that looks up the catalogueId in
 * this map, builds a NodeHandlerContext, and calls the function.
 *
 * Adding a new node:
 *   1. Create handlers/<id>.ts exporting `handle<ID>: NodeHandler`
 *   2. Import + register it here
 *   3. Add the catalogueId to REAL_NODE_IDS in route.ts
 */

import type { NodeHandler } from "./types";

import { handleTR001 } from "./tr-001";
import { handleTR003 } from "./tr-003";
import { handleTR004 } from "./tr-004";
import { handleTR005 } from "./tr-005";
import { handleTR007 } from "./tr-007";
import { handleTR008 } from "./tr-008";
import { handleTR012 } from "./tr-012";
import { handleTR013 } from "./tr-013";
import { handleTR014 } from "./tr-014";
import { handleTR015 } from "./tr-015";
import { handleTR016 } from "./tr-016";
import { handleTR022 } from "./tr-022";
import { handleTR024 } from "./tr-024";
import { handleGN001 } from "./gn-001";
import { handleGN003 } from "./gn-003";
import { handleGN004 } from "./gn-004";
import { handleGN007 } from "./gn-007";
import { handleGN008 } from "./gn-008";
import { handleGN009 } from "./gn-009";
import { handleGN010 } from "./gn-010";
import { handleGN011 } from "./gn-011";
import { handleGN012 } from "./gn-012";
import { handleEX001 } from "./ex-001";
import { handleEX002 } from "./ex-002";
import { handleEX003 } from "./ex-003";
import { handleEX006 } from "./ex-006";
// Canvas Unification (2026-05-17): GN-013 mega-node deleted, replaced
// by the 4-node decomposition TR-025 → TR-026 → TR-027 → EX-007.
import { handleTR025 } from "./tr-025";
import { handleTR026 } from "./tr-026";
import { handleTR027 } from "./tr-027";
import { handleTR028 } from "./tr-028";
// Phase Beta 2 (2026-05-18): 5 new pipeline nodes
import { handleTR029 } from "./tr-029";
import { handleTR030 } from "./tr-030";
import { handleTR031 } from "./tr-031";
import { handleTR032 } from "./tr-032";
import { handleTR034 } from "./tr-034";
// Phase Beta 3 (2026-05-18): self-correcting pipeline nodes
import { handleTR033 } from "./tr-033";
import { handleTR035 } from "./tr-035";
import { handleEX007 } from "./ex-007";

export const nodeHandlers: Record<string, NodeHandler> = {
  "TR-001": handleTR001,
  "TR-003": handleTR003,
  "TR-004": handleTR004,
  "TR-005": handleTR005,
  "TR-007": handleTR007,
  "TR-008": handleTR008,
  "TR-012": handleTR012,
  "TR-013": handleTR013,
  "TR-014": handleTR014,
  "TR-015": handleTR015,
  "TR-016": handleTR016,
  "TR-022": handleTR022,
  "TR-024": handleTR024,
  "TR-025": handleTR025,
  "TR-026": handleTR026,
  "TR-027": handleTR027,
  "TR-028": handleTR028,
  "TR-029": handleTR029,
  "TR-030": handleTR030,
  "TR-031": handleTR031,
  "TR-032": handleTR032,
  "TR-033": handleTR033,
  "TR-034": handleTR034,
  "TR-035": handleTR035,
  "GN-001": handleGN001,
  "GN-003": handleGN003,
  "GN-004": handleGN004,
  "GN-007": handleGN007,
  "GN-008": handleGN008,
  "GN-009": handleGN009,
  "GN-010": handleGN010,
  "GN-011": handleGN011,
  "GN-012": handleGN012,
  "EX-001": handleEX001,
  "EX-002": handleEX002,
  "EX-003": handleEX003,
  "EX-006": handleEX006,
  "EX-007": handleEX007,
};

export type { NodeHandler, NodeHandlerContext, NodeHandlerResult } from "./types";
