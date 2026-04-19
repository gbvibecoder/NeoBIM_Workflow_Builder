# TR-007 Entity-Type Audit — Pre-Phase-2

> **Context:** Phase 1 Track C schema landing adds 13 new `GeometryElement.type`
> literals and 8 new IFC4 `ifcType` values. Per amendment C5, Phase 2 needs a
> baseline of what TR-007 (Quantity Extractor) already recognizes so we know
> exactly which new types need parser/aggregator work versus those that already
> flow through.
>
> TR-007 is a **consumer** of IFC (reads uploaded files, extracts quantities).
> This audit is NOT about the Python builder's producer-side dispatch —
> that audit lives with the builder work in Phase 2 itself.
>
> Last updated: 2026-04-17 (Track C commit).

## How TR-007 currently classifies elements

Source: `src/app/api/execute-node/handlers/tr-007.ts`. TR-007 does not enumerate
IFC classes by name in its main pipeline; it aggregates whatever element `type`
string the upstream parser (`src/features/ifc/services/ifc-parser.ts`) returned,
keyed by `${element.type}|${storey}|{external?}`.

There are three places where the IFC class name *is* special-cased:

| Location | Class | Purpose |
|---|---|---|
| L155, L292 | `IfcWall`, `IfcWallStandardCase` | External vs internal split |
| L150, L284 | `IfcCovering` (+ `PredefinedType`) | Flooring/Ceiling/Cladding/Roofing relabel |
| L186, L322 | `IfcRailing`, `IfcMember` (`LINEAR_TYPES`) | Report length in Rmt instead of area/volume |
| L175, L310 | `IfcRailing` (length fallback) | Estimate 3 m/unit when parser reports no length |
| L427 | `IfcFooting`, `IfcPile` | Flag structural foundation presence |
| L458–460 | `IfcPipe*`, `IfcDuct*`, `IfcCable*` | Classify MEP discipline |

Everything else TR-007 receives is aggregated generically: `description =
elementType.replace("Ifc", "")`, unit chosen by fallback (`m²` → `m³` → `EA`).

## Existing coverage

The upstream parser (`parseIFCBuffer` at `src/features/ifc/services/ifc-parser.ts`)
is what decides which classes reach TR-007. Classes that flow through today
**and** are matched by TR-007's special cases:

- `IfcWall`, `IfcWallStandardCase` — with external/internal discrimination
- `IfcSlab`, `IfcRoof` — area/volume (generic path)
- `IfcColumn`, `IfcBeam` — area/volume (generic path)
- `IfcWindow`, `IfcDoor` — count + area (generic path)
- `IfcSpace` — area (generic path)
- `IfcStairFlight` — area/volume (generic path)
- `IfcRailing` — length in Rmt (with 3 m fallback)
- `IfcCovering` + `PredefinedType` (FLOORING, CEILING, CLADDING, ROOFING)
- `IfcFooting`, `IfcPile` — foundation flag + area/volume
- `IfcMember`, `IfcPlate` — length in Rmt (IfcMember), area (IfcPlate, generic)
- `IfcPipeSegment`, `IfcDuctSegment`, `IfcCableCarrierSegment` — MEP classification

## Gaps vs Track C new types

Track C adds **13 new `type` literals** and **8 new `ifcType` values**. The table
below records which ones TR-007 handles *automatically* via the generic
fallback path vs which ones need Phase 2 work.

| Track C `type` | Track C `ifcType` | TR-007 auto-handled? | Phase-2 work required |
|---|---|---|---|
| `railing` | `IfcRailing` | ✅ already special-cased | none |
| `ramp` | `IfcRamp` | ⚠️ generic fallback (treated as "Ramp", area/vol) | OK for baseline; consider Rmt vs m² nuance later |
| `covering-ceiling` | `IfcCovering` | ✅ already special-cased (via PredefinedType) | ensure Python builder sets `PredefinedType=CEILING` |
| `covering-floor` | `IfcCovering` | ✅ already special-cased (via PredefinedType) | ensure Python builder sets `PredefinedType=FLOORING` |
| `furniture` | `IfcFurniture` | ⚠️ generic fallback (EA unit likely) | Phase 2: exclude from BOQ or flag as optional |
| `plate` | `IfcPlate` | ⚠️ generic fallback (m²) | OK |
| `member` | `IfcMember` | ✅ already special-cased (linear, Rmt) | none |
| `footing` | `IfcFooting` | ✅ already special-cased (foundation flag) | none |
| `curtain-wall` | `IfcCurtainWall` | ⚠️ generic fallback, but TR-007's wall external/internal heuristic only fires for `IfcWall`/`IfcWallStandardCase` — curtain walls will aggregate as their own group | Phase 2: decide whether to treat curtain-wall area like exterior wall for envelope-area metrics |
| `sanitary-terminal` | `IfcSanitaryTerminal` | ❌ **not** routed to MEP category (mepCat heuristic at L458 matches only Pipe/Duct/Cable substrings) | Phase 2: extend mepCat match for `IfcSanitaryTerminal` → "Plumbing (MEP IFC)" |
| `light-fixture` | `IfcLightFixture` | ❌ **not** routed to MEP category | Phase 2: extend mepCat match → "Electrical (MEP IFC)" |
| `air-terminal` | `IfcAirTerminal` | ❌ **not** routed to MEP category | Phase 2: extend mepCat match → "HVAC (MEP IFC)" |
| `flow-terminal` | `IfcFlowTerminal` | ❌ **not** routed; generic MEP terminal | Phase 2: extend mepCat match → default "MEP Services" |

### Parser-side gaps

The table above assumes the parser (`parseIFCBuffer`) already traverses these
new classes. Phase 2 must confirm — a producer emitting `IfcFurniture` is
useless if the parser's IFC class loop doesn't iterate over `IfcFurniture`
instances. That audit should read `src/features/ifc/services/ifc-parser.ts`
once the producer is live, not speculatively now.

## Recommendations for Phase 2

1. **Three small changes to TR-007** close the three ❌ rows above in one
   commit: extend the `mepCat` substring matcher at L458–460 from
   `Pipe|Duct|Cable` to also match `SanitaryTerminal|LightFixture|AirTerminal|FlowTerminal`.
2. **Curtain-wall envelope area** is a Phase 2 policy decision — whether it
   should aggregate into the wall-external pool for envelope metrics, or stay
   in its own group. Recommend: its own group, and consumers downstream (BOQ
   visualizer, BG-001) decide.
3. **Parser-side audit of `IfcRamp`, `IfcFurniture`, `IfcPlate`, `IfcCurtainWall`,
   `IfcSanitaryTerminal`, `IfcLightFixture`, `IfcAirTerminal`** — must happen
   in Phase 2 *after* the Python builder starts emitting these classes, so we
   can verify end-to-end round-trip (producer emits → parser reads → TR-007
   aggregates → BG-001 costs).

## What Track C does not need

- **No TR-007 code changes in Track C.** Track C is schema-only per the
  sub-plan. Builder + consumer work are Phase 2 concerns. Landing this audit
  is the contract: Phase 2 starts with a known baseline.
- **No parser changes in Track C.** Same reason.
