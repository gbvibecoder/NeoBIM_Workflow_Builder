/**
 * Tool definitions for the v3 generator agent loop.
 *
 * Four tools — exactly the surface from the Phase v3 prompt. The
 * descriptions are tuned for Claude Opus 4.7's tool-use semantics:
 * each one tells the model WHAT the tool does, WHEN to call it, and
 * the SHAPE of the result (so the model doesn't have to introspect
 * the response — it can reason about it directly).
 *
 * Schemas are deliberately minimal: only `run_python` takes a payload.
 * The other three are stateful operations on the session's IFC.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const TOOL_RUN_PYTHON = "run_python";
export const TOOL_VALIDATE_IFC = "validate_ifc";
export const TOOL_READ_IFC_SUMMARY = "read_ifc_summary";
export const TOOL_FINALIZE_IFC = "finalize_ifc";

export const V3_TOOL_NAMES = [
  TOOL_RUN_PYTHON,
  TOOL_VALIDATE_IFC,
  TOOL_READ_IFC_SUMMARY,
  TOOL_FINALIZE_IFC,
] as const;

export type V3ToolName = (typeof V3_TOOL_NAMES)[number];

/** The full Anthropic tool list for the v3 generator agent. */
export function v3GeneratorTools(): Anthropic.Tool[] {
  return [
    {
      name: TOOL_RUN_PYTHON,
      description:
        "Execute Python code in the IFC sandbox. The session is " +
        "persistent across calls. `bf` is a pre-instantiated " +
        "BuildFlowIFC instance with the brief loaded. Always " +
        "print() any data you want to see back.\n\n" +
        "Available helpers on `bf`:\n" +
        "  • bf.add_space(id, polygon, height, long_name='', occupancy='')\n" +
        "  • bf.add_circular_space(id, centre, radius, height, ...)\n" +
        "  • bf.add_slab(id, origin, dims, depth, material, predefined_type='FLOOR')\n" +
        "  • bf.add_wall(id, origin, dims, depth, material, rotation=0.0)\n" +
        "  • bf.add_column(id, origin, dims, depth, material)\n" +
        "  • bf.add_circular_column(id, origin, radius, depth, material)\n" +
        "  • bf.add_beam(id, origin, dims, depth, material)\n" +
        "  • bf.add_covering(id, origin, dims, depth, material, predefined_type='FLOORING')\n" +
        "  • bf.add_proxy(id, origin, dims, depth, material, object_type='', composition='ELEMENT')\n" +
        "      — composition MUST be 'COMPLEX' / 'ELEMENT' / 'PARTIAL' (NOT 'NOTDEFINED')\n" +
        "  • bf.add_furniture(id, origin, dims, depth, material, object_type='')\n" +
        "  • bf.add_light_fixture(id, origin, dims, depth, material, object_type='')\n" +
        "  • bf.add_door(id, origin, dims, depth, material, object_type='')\n" +
        "      — MUST be used for every brief element with type='door'. Emits IfcDoor.\n" +
        "  • bf.add_window(id, origin, dims, depth, material, object_type='')\n" +
        "      — MUST be used for every brief element with type='window'. Emits IfcWindow.\n" +
        "      — DO NOT route doors/windows to add_proxy or add_furniture (they would\n" +
        "        disappear from BIM-tool schedules + clash detection).\n" +
        "  • bf.attach_pset([element_ids...], pset_name, {properties...})\n" +
        "  • bf.attach_qto(element_id, {quantities...})\n" +
        "Allowed imports: ifcopenshell, numpy, math, json, dataclasses, " +
        "typing, collections, itertools, functools, uuid. " +
        "BLOCKED: os, subprocess, socket, urllib, open(), file IO outside bf.\n" +
        "On error: the response includes the full Python traceback in " +
        "`error_traceback` — read it and fix the next call accordingly.",
      input_schema: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "The Python code to execute. Multi-line OK. `bf` is in " +
              "scope. Print results you want to read.",
          },
        },
        required: ["code"],
      },
    },
    {
      name: TOOL_VALIDATE_IFC,
      description:
        "Run the current session IFC through a structural validator. " +
        "Returns entity count, reference resolution, schema conformance, " +
        "list of spaces present in the file, and a smoke-test verdict " +
        "for whether the file will load in web-ifc.\n\n" +
        "Call this AFTER you've added every element from the spec and " +
        "BEFORE `finalize_ifc`. If `refs_resolve` is false or " +
        "`web_ifc_load_test` is `FAIL`, fix the issues before finalizing.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: TOOL_READ_IFC_SUMMARY,
      description:
        "Return a structured summary of the current IFC: spaces list, " +
        "element counts by class, materials assigned, property sets " +
        "present. Use this to check progress against the brief without " +
        "running validation.",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: TOOL_FINALIZE_IFC,
      description:
        "Mark the IFC as complete. Triggers final validation and upload " +
        "to R2. Returns the public URL. Call this ONCE, when every space " +
        "from the brief is present, every element has been added, and " +
        "`validate_ifc` reports `refs_resolve: true` with `web_ifc_load_test: PASS`.",
      input_schema: { type: "object", properties: {} },
    },
  ];
}
