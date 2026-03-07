# NeoBIM Input Node Test Cheatsheet

Quick-reference for testing all 7 input nodes with realistic AEC data.

---

## IN-001: Text Prompt

**What to do:** Paste text into the Text Prompt node on canvas.

| Test Level | What to Type | Expected Result | Pass Criteria |
|---|---|---|---|
| Simple | `Design a 5 storey residential apartment building in Mumbai with ground floor parking, 4 flats per floor, total GFA 3200 sqm, contemporary style with large balconies` | Building description with 5 floors, Mumbai location, 3200 sqm | Floors = 5, mentions Mumbai, GFA close to 3200 |
| Intermediate | `Mixed-use development in Pune, Hinjewadi IT Park area. Ground floor: 800 sqm retail + lobby. Floors 1-3: 2400 sqm Grade A office space. Floors 4-8: 40 residential flats (2BHK and 3BHK mix). Rooftop: amenity deck with swimming pool. Total GFA: 12000 sqm. Style: modern glass facade with terracotta fins for solar shading. IGBC Green certification target.` | Building description with retail + office + residential, 12000 sqm | Mixed-use type, 8+ floors, mentions Pune |
| Complex | `High-rise residential tower, Bandra Kurla Complex Mumbai. B+G+32 floors. Basement: 200 car parking...` *(full text in test data file)* | Detailed 32-floor tower description | 32 floors, BKC/Mumbai, 48000 sqm GFA |

---

## IN-002: PDF Upload

**What to do:** Upload a PDF file to the PDF Upload node.

| Test File | Specs | Expected Result | Pass Criteria |
|---|---|---|---|
| `BKC_Residential_Tower_Client_Brief_v3.pdf` | 12 pages, ~847 KB | Parsed brief with project title, site info, program, budget | Project type detected, floors detected, GFA extracted |
| Any real architectural brief PDF | < 20 MB, text-based (not scanned) | Structured extraction of project requirements | At least project title and type extracted |
| Edge: scanned PDF (image-only) | Any size | Error message suggesting to use Text Prompt instead | Graceful error, no crash |

---

## IN-003: Image Upload

**What to do:** Upload an image to the Image Upload node.

| Test File | Type | Expected Result | Pass Criteria |
|---|---|---|---|
| Site aerial photo (.jpg) | Site photograph, < 10 MB | Scene analysis identifying plot, roads, context | Scene type detected, elements listed |
| Facade reference (.jpg) | Reference image | Style/material analysis | Style and materials identified |
| Hand sketch (.jpg) | Concept sketch | Massing and feature detection | Massing type or features detected |
| Edge: non-architectural image | Any photo | "Not Architectural" classification | Graceful handling, no crash |

---

## IN-004: IFC Upload

**What to do:** Upload an IFC file to the IFC Upload node.

| Test File | Specs | Expected Result | Pass Criteria |
|---|---|---|---|
| Any IFC2X3 or IFC4 model | < 50 MB, `.ifc` extension | Quantity extraction table with element counts | Elements parsed > 0, schema detected |
| Small test IFC (e.g. Revit sample) | < 5 MB | Fast parsing with wall/slab/column counts | Processing time < 20s |
| Edge: empty IFC | Valid header, 0 elements | Meaningful "no elements found" message | No crash, clear message |

---

## IN-005: Parameter Input

**What to do:** Fill in the parameter fields on the Parameter Input node.

| Test Set | Exact Values | Expected Result | Pass Criteria |
|---|---|---|---|
| Simple Residential | Floors: `5`, GFA: `3200`, Height: `17.5`, Style: `Modern` | Parameters stored as JSON, feeds downstream | All values > 0, style non-empty |
| Mixed-Use | Floors: `12`, GFA: `14400`, Height: `42.0`, Style: `Modern` | Parameters accepted | Floor-to-floor height 2.5-5m |
| High-Rise | Floors: `32`, GFA: `48000`, Height: `112.0`, Style: `Modern` | Parameters accepted | All validations pass |
| Edge: Invalid | Floors: `-1`, GFA: `0` | Validation warning | Negative/zero values flagged |

---

## IN-006: Location Input

**What to do:** Type a location string into the Location Input node.

| Test Location | What to Type | Expected Result | Pass Criteria |
|---|---|---|---|
| Mumbai | `Bandra Kurla Complex, Mumbai, Maharashtra` | Lat/Lng, climate data, elevation, solar angles | Coordinates near 19.06, 72.87 |
| Pune | `Hinjewadi IT Park Phase 2, Pune, Maharashtra` | Site analysis with climate zone | City identified as Pune |
| Bengaluru | `Whitefield, Bengaluru, Karnataka` | Climate and seismic zone data | Seismic Zone II |
| Noida | `Sector 62, Noida, Uttar Pradesh` | Site context data | Seismic Zone IV (high) |
| Kolkata | `Newtown Action Area 2, Kolkata, West Bengal` | Climate and context | Hot humid climate |
| Edge: Unknown | `Xyzzyville, Nowhere, Mars` | Fallback or error message | No crash, meaningful message |

---

## IN-007: DXF/DWG Upload

**What to do:** Upload a DXF or DWG file to the DXF/DWG Upload node.

| Test File | Specs | Expected Result | Pass Criteria |
|---|---|---|---|
| Site plan `.dxf` | < 30 MB, has SITE-BOUNDARY layer | Layer listing with entity counts | Layers detected, AEC keywords found |
| Floor plan `.dwg` | < 30 MB, has WALLS/DOORS layers | Room and area extraction | Multiple layers parsed |
| Edge: no AEC layers | Generic DXF with Layer1, Layer2 | Warning suggesting standard layer names | Warning shown, no crash |

---

## Running the Automated Test Suite

1. Open the app in development mode (`npm run dev`)
2. Navigate to **Dashboard > Test Suite** (bottom of sidebar, dev only)
3. Click **Run All Tests**
4. Review the results dashboard for pass/fail/skip status
5. Expand any row to see validation checks and input/output data

---

## Quick Pass/Fail Reference

| Node | Min Input | What Makes It FAIL |
|---|---|---|
| IN-001 | >= 10 characters | Empty string, null, whitespace only |
| IN-002 | Valid PDF, < 20 MB | Wrong file type, scanned-only PDF, > 20 MB |
| IN-003 | Valid image, < 10 MB | Wrong file type, > 10 MB |
| IN-004 | Valid IFC, < 50 MB | Invalid IFC, 0 elements, > 50 MB |
| IN-005 | Floors > 0, GFA > 0 | Negative floors, zero GFA, missing style |
| IN-006 | >= 3 characters | Empty string, unresolvable location |
| IN-007 | Valid DXF/DWG, < 30 MB | Wrong file type, > 30 MB |
