# Sample brief fixtures — Phase 2A Slice 2A.3

These 7 files are **placeholders**. The real briefs will be authored by
Govind (Indian-market-realistic content) and dropped in at Slice 2A.5 /
2A.6 when the BriefAnalyst and ProgramArchitect stages need realistic
inputs to test against.

For Slice 2A.3, only `tests/test_design_pdf_extractor.py::test_all_sample_brief_fixtures_exist`
asserts that all 7 files are present. Content tests (assertions on
extracted text, expected `BriefAnalysis` fields, expected `RoomProgram`
shape) are deferred to Slices 2A.5 / 2A.6.

| Fixture | Purpose |
|---|---|
| `2bhk_24x50.pdf` | text-based PDF, 1 page; 2BHK on 24'x50' Pune plot |
| `circular_futuristic.txt` | narrative-leaning brief |
| `g_plus_5_apartment_form.json` | parametric `BriefForm` JSON |
| `4_storey_office_curtainwall.txt` | commercial office, curtain-wall facade |
| `bungalow_gable.txt` | 2-storey traditional bungalow, Vastu-compliant |
| `warehouse.txt` | single-storey steel-frame warehouse |
| `hospital_3floor.txt` | NBC Group C 3-floor hospital |
