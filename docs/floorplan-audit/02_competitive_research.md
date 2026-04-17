# 02_competitive_research.md

## TL;DR (≤10 bullets)

- The competitive set splits cleanly into two camps: (1) **rule/parametric/optimization tools for developers** (Archistar, TestFit, Hypar, ArkDesign, Spacemaker/Forma) and (2) **ML/diffusion/LLM-driven layout generators for architects/owners** (Finch3D, Maket.ai, LookX). No single tool dominates both worlds.
- **Spacemaker / Autodesk Forma is the most technically mature** for early-stage urban/site planning — real-time microclimate, wind, daylight, noise via UTCI and ML surrogates, GIS-pulled context, and an explicit GAN-based floor plan research line ([Spacemaker Pix2Pix research](https://medium.com/spacemaker-research-blog/space-layouts-gans-2329c8f85fe8)). HIGH confidence.
- **Finch3D's "Finch Graph" is the closest published analog to a relational/CSP-style approach**: an auto-derived graph of room/object relationships drives optimization, and the 2.0 Floor Plate engine *explicitly explains why a unit mix won't work* — this is the single most relevant transparency feature in the field for BuildFlow ([AECMag, 2024](https://aecmag.com/ai/finch3d-starts-to-sing/)). HIGH confidence.
- **TestFit and ArkDesign dominate "yield study" workflows** (units/parking/FAR optimization) for multifamily developers; both are constraint+parametric solvers under the hood, not deep learning. ArkDesign holds [US Patent 11,972,174](https://arkdesign.ai/faq/) and is hard-coded around US/NYC zoning.
- **Maket.ai is conversational + ML-trained on residential layouts** but is honest about its limits: no structural, no MEP, no code compliance ([Maket guide 2026](https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026)). It's the closest UX analog to what BuildFlow could ship in a chat-driven workflow.
- **Hypar is parametric-functions-as-a-service**, not generative AI. Founder Ian Keough explicitly says "this isn't AI, but AI informed through natural language input" ([AECMag](https://aecmag.com/ai/hypar-text-to-bim-and-beyond/)). It exports IFC and Revit; output is "fairly rectilinear, no NURBS yet."
- **LookX AI is a rendering tool, not a layout tool.** Despite being marketed alongside floor-plan tools, it generates raster images (text/sketch → render) and does not produce dimensioned plans ([LookX](https://www.lookx.ai/)). Don't benchmark BuildFlow's layout engine against it.
- **Academic state of the art has shifted from GAN → diffusion → LLM+diffusion** in ~24 months: HouseDiffusion (CVPR 2023) beat House-GAN++ by 67% diversity / 32% compatibility; HouseTune (2024) added an LLM front-end and beat HouseDiffusion by 28% diversity / 79% compatibility; ChatHouseDiffusion (Oct 2024) added conversational editing.
- **Almost no commercial tool engineers explicit "rationale per design move."** Finch3D is the only one with documented "explain why this fails" feedback. This is BuildFlow's most defensible UX wedge.
- **Vastu/Feng Shui is essentially absent from serious tools** — only consumer-grade scoring apps (Grihafy, AI Feng Shui App) cover it. For Indian residential, this is wide-open white space.

## Tool cards

### Archistar

1. **Algorithm (MEDIUM-LOW confidence):** Public materials describe a generative-then-rank pipeline ("set constraints and goals … rejecting all the poor solutions … creating another set of solutions based on the features with the highest scores") which reads like an evolutionary/multi-objective optimizer over parametric massing, not deep learning ([Archistar blog](https://www.archistar.ai/blog/archistars-generative-design-engine/)). No public algorithm paper. They market AI but technical primitives are not disclosed — likely a parametric massing engine + scoring + ranked filter, with deep ML possibly only in image/PDF parsing for AI PreCheck.
2. **Requirements extraction:** Form-driven — building type, dimensions, density, footprint, property class. Site context is auto-pulled from Archistar's 25,000+ data sources (GIS, parcel, zoning) ([Generative Design page](https://www.archistar.ai/generative-design/)).
3. **Validation/dialog:** Outputs are scored & filtered; users see ranked viable designs. No documented free-text dialog when ask is infeasible — they show fewer/no compliant outputs.
4. **Compliance:** Strong on AU and US — AI PreCheck digitizes zoning + building code for 25+ municipalities (Edmonton, Austin, LA County, Vancouver, NSW, SA) ([for-architects](https://www.archistar.ai/for-architects/)). Setbacks, FSR, height, sunlight, shadowing all evaluated. No Vastu/Feng Shui.
5. **Transparency:** Each design surfaces metrics (GFA, FSR, footprint, dwelling counts, winter sun %), but no per-move rationale.
6. **What we could adopt:** The auto-pull of GIS/zoning context as the base layer of any project; metric-rich design cards; report export.
7. **Sources:** [Generative Design](https://www.archistar.ai/generative-design/), [Engine blog](https://www.archistar.ai/blog/archistars-generative-design-engine/), [AI PreCheck](https://www.archistar.ai/for-architects/), [Master planning](https://www.archistar.ai/blog/ai-master-planning/).

### TestFit

1. **Algorithm (MEDIUM confidence):** Self-described as "algorithmic modeling with the simplicity of parametric modeling" with three engines combined for multifamily ([Residential Engine post](https://www.testfit.io/blog/residential-engine-for-multi-family-design)). Generative Design is a brute-force parametric search ("a machine can test every possible configuration") ranked by KPIs (FAR, parking ratio, yield on cost) ([TestFit GD launch](https://www.testfit.io/news/testfit-launches-groundbreaking-generative-design-for-better-building-optimization)). Not ML-based per public materials.
2. **Requirements extraction:** Form + saved presets ("import your existing unit and building configurations"). KPI sliders for FAR, parking, cost.
3. **Validation/dialog:** No documented free-text dialog. Infeasibility surfaces as empty/poor KPI scores; user re-tunes inputs. "Once you select a preferred solution, it will automatically regenerate similar solutions" — a refine-around-pick loop.
4. **Compliance:** Building-type-specific presets (podium, wrap, townhome, tower); parking codes; setbacks; US-centric.
5. **Transparency:** Output presented as bar charts, deal cards, and side-by-side comparisons — but rationale per move is not exposed.
6. **What we could adopt:** Preset-driven configurability; KPI-first ranking UI; "regen near my favorite" loop.
7. **Sources:** [GD launch](https://www.testfit.io/news/testfit-launches-groundbreaking-generative-design-for-better-building-optimization), [GD blog](https://www.testfit.io/blog/unleash-boundless-building-optimization-with-testfit-generative-design), [Residential Engine](https://www.testfit.io/blog/residential-engine-for-multi-family-design), [AECMag coverage](https://aecmag.com/news/testfit-generative-design-targets-building-optimisation/).

### Finch3D

1. **Algorithm (HIGH confidence on graph; MEDIUM on solver):** Patented "Finch Graph" — an *auto-generated* relational graph of spaces and objects — drives an optimization engine. Architects layer rule constraints ("all en-suite bathrooms > 4 m²", "all double bedrooms wheelchair-accessible and > 2.75 m"). Floor Plate Studio 2.0 introduced range-based constraints (e.g. number of stairwells), exact area targeting, and depth/dual-aspect ratio handling ([AECMag](https://aecmag.com/ai/finch3d-starts-to-sing/), [Architosh](https://architosh.com/2024/09/finch3d-advances-ai-based-floor-plan-generator/), [Medium graph rules](https://medium.com/finch3d/introducing-finch-graph-rules-revolutionizing-the-design-process-for-architects-2082d7d127bb)). The exact solver type (ILP, CSP, GA, custom) is proprietary.
2. **Requirements extraction:** Rule entry in a structured UI + sketch/draw walls in Plan Studio with an AI Co-Pilot (press "U" to get room-type suggestions on drawn rooms) ([Finch docs](https://docs.finch3d.com/courses/drawing-and-generating-floor-plans-in-finch/drawing-a-floor-plan-with-ai-co-pilot)). Runs in Rhino, Revit, Grasshopper.
3. **Validation/dialog:** **Best in class.** AECMag explicitly notes: "if a unit mix won't work, it explains why" — the only commercial tool we found with documented infeasibility explanation.
4. **Compliance:** Through user-defined rules; ships dashboard feedback on areas, light, CO₂. No documented built-in jurisdictional code library — compliance is rule-encoded by the user.
5. **Transparency:** Rule-driven means designers see exactly which rule blocked what; dashboard surfaces metrics during iteration.
6. **What we could adopt:** **The Finch Graph idea is the single most adoptable pattern.** Auto-deriving a relational graph from a sketch + letting the user layer rules + returning *why* a constraint set is infeasible is a direct fit for our CSP work (we already have H_DIRECTIONAL, H_BETWEEN, H_CONNECTS_ALL — they map naturally to Finch-style graph rules).
7. **Sources:** [Finch3D](https://www.finch3d.com), [AECMag](https://aecmag.com/ai/finch3d-starts-to-sing/), [Architosh](https://architosh.com/2024/09/finch3d-advances-ai-based-floor-plan-generator/), [Graph Rules](https://medium.com/finch3d/introducing-finch-graph-rules-revolutionizing-the-design-process-for-architects-2082d7d127bb), [Plan Studio docs](https://docs.finch3d.com/courses/drawing-and-generating-floor-plans-in-finch/drawing-a-floor-plan-with-ai-co-pilot).

### Spacemaker / Autodesk Forma

1. **Algorithm (HIGH confidence):** Hybrid stack. (a) Parametric/generative massing engine ("Explore" produces dozens-to-hundreds of variants under user constraints). (b) Documented Pix2Pix GAN research line for unit-level floor plan generation from footprint + facade openings ([Spacemaker Research](https://medium.com/spacemaker-research-blog/space-layouts-gans-2329c8f85fe8)). (c) Many "analyses" are ML/heuristic surrogates of physical simulators (wind, microclimate UTCI, daylight) for near-real-time feedback ([Forma microclimate](https://blogs.autodesk.com/forma/2023/05/08/updated-microclimate-analysis-allows-intuitive-insights-perceived-temperature/)).
2. **Requirements extraction:** Form-driven; site context auto-pulled (terrain, footprints, infrastructure, zoning, weather). Acquired by Autodesk in 2020 for $240M; rebranded May 2023 ([Forma overview](https://aifindertools.com/autodesk-forma/)).
3. **Validation/dialog:** No conversational dialog. Infeasibility surfaces as failed analyses or low scores; user adjusts inputs.
4. **Compliance:** Strong on environmental constraints (sun, wind, noise, daylight, embodied/operational carbon); zoning is loaded as constraint metadata, not solver-checked the way Archistar/Ark do for US codes. Originally Nordic-tuned.
5. **Transparency:** Color-coded heatmaps over the site for every analysis; multi-criterion compare across schemes. Per-move rationale: not surfaced.
6. **What we could adopt:** ML surrogates for slow simulations (wind, daylight) — huge UX win; multi-criterion compare grid; auto-pull of site context; the explicit research-blog culture lets prospects see what's real.
7. **Sources:** [Forma overview](https://aifindertools.com/autodesk-forma/), [Forma review](https://illustrarch.com/articles/design-softwares/73363-autodesk-forma-review.html), [Microclimate blog](https://blogs.autodesk.com/forma/2023/05/08/updated-microclimate-analysis-allows-intuitive-insights-perceived-temperature/), [Spacemaker GAN research](https://medium.com/spacemaker-research-blog/space-layouts-gans-2329c8f85fe8), [ArchDaily](https://www.archdaily.com/952850/spacemaker-proposes-ai-powered-generative-design-to-create-more-sustainable-spaces-and-cities).

### Maket.ai

1. **Algorithm (MEDIUM confidence):** ML-trained on "thousands of existing residential layouts." Three-stage pipeline: interpret constraints → generate variations satisfying them while optimizing for "livability, natural light, and logical room groupings" → return editable plans ([Maket guide 2026](https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026)). Architecture not disclosed; could be a learned seq2seq, a retrieval-augmented graph predictor, or a diffusion variant — public materials don't say.
2. **Requirements extraction:** **Best-in-class natural-language UX.** Plain-text brief (size, shape, rooms, stories) → dimensioned layout. Edits via conversation ("move the kitchen to the south wall") *or* directly on canvas — only commercial tool we found with bidirectional chat editing.
3. **Validation/dialog:** Conversational (chat is the editing surface), but no documented "explain why this is infeasible" capability.
4. **Compliance:** **Honest "we don't do this":** explicitly excludes structural, MEP, building code compliance, commercial buildings. No Vastu/Feng Shui. No country-specific code library.
5. **Transparency:** Output covers "70-75% of what schematic design produces." User sees the result; rationale not surfaced.
6. **What we could adopt:** The chat-first edit loop is exactly what BuildFlow should ship. Their honesty about limits is also a brand model.
7. **Sources:** [Maket.ai](https://www.maket.ai/), [Guide 2026](https://www.maket.ai/blog/ai-floor-plan-generator-guide-2026).

### Hypar

1. **Algorithm (HIGH confidence):** **Parametric, not generative AI.** Founder Ian Keough on the record: "Behind the scenes, Hypar is magically mapping the natural language input … onto Hypar parametric functions. *This isn't AI, but AI informed through natural language input.*" ([AECMag](https://aecmag.com/ai/hypar-text-to-bim-and-beyond/)). Built ground-up: own geometry kernel, own functions in Python/C#, JSON schema for BIM elements. Hypar 2.0 narrowed scope to space planning + "bubble mode" diagrammatic input ([AECMag Hypar 2.0](https://aecmag.com/features/hypar-2-0/), [BIMpure](https://www.bimpure.com/blog/inside-hypar-2-the-future-of-space-planning)).
2. **Requirements extraction:** Bubble diagram + Excel/CSV space program + site polygons; layered functions. Auto-furniture suggestions per space type.
3. **Validation/dialog:** No conversational dialog. Functions either run or fail; no explanatory loop documented.
4. **Compliance:** Not the focus. Outputs Revit-native and IFC export ([Cheat sheet](https://integratedbim.com/hypar-cheat-sheet/)). Code compliance is whatever the user encodes in their function.
5. **Transparency:** Functions are explicit code → fully transparent at the function level, but not at the "why this layout" level. Open source core libraries on GitHub ([hypar-io/Elements](https://github.com/hypar-io/Elements)).
6. **What we could adopt:** Composable functions architecture; IFC export discipline; the "BIM-as-data" JSON schema discipline. Limitation: rectilinear only, no NURBS — same constraint we have today.
7. **Sources:** [Hypar](https://hypar.io/), [AECMag text-to-BIM](https://aecmag.com/ai/hypar-text-to-bim-and-beyond/), [AECMag Hypar 2.0](https://aecmag.com/features/hypar-2-0/), [BIMpure](https://www.bimpure.com/blog/inside-hypar-2-the-future-of-space-planning).

### LookX AI

1. **Algorithm (MEDIUM confidence):** **Image generation, not layout generation.** Almost certainly a fine-tuned diffusion model (Stable Diffusion / SDXL family) with architectural LoRAs and a style-adapter. Public materials describe "real-time" rendering and "any2any (image-class-text2img)" — consistent with diffusion + ControlNet + style adapters. No published architectural details ([LookX](https://www.lookx.ai/), [EliteAI](https://eliteai.tools/tool/lookxai)).
2. **Requirements extraction:** Text prompts + sketch upload; SketchUp/Rhino plugins for in-tool use.
3. **Validation/dialog:** No layout validation — output is a raster render, not a dimensioned plan.
4. **Compliance:** N/A — does not produce dimensioned, code-checkable artifacts.
5. **Transparency:** Prompt-engineering helpers expand short prompts into longer descriptions; no design rationale.
6. **What we could adopt:** Style-adapter pattern (upload reference image to set look) is a nice UX in the *render* side of our pipeline (we already have GN-003). Do **not** position as a competitor on layout.
7. **Sources:** [LookX](https://www.lookx.ai/), [EliteAI](https://eliteai.tools/tool/lookxai), [LightX comparison](https://www.lightxeditor.com/photo-editing/ai-floor-plan-generator/).

### ArkDesign.ai

1. **Algorithm (MEDIUM confidence):** Constraint-driven schematic-design solver — "sophisticated constraint-checking algorithms that continuously monitor design changes against zoning requirements, accessibility standards, egress codes, and efficiency targets" ([aec+tech](https://www.aecplustech.com/tools/arkdesign-ai), [aec+tech blog](https://www.aecplustech.com/blog/multi-family-mixed-use-design-through-ai-meet-arkdesign)). Holds [US Patent 11,972,174](https://arkdesign.ai/faq/) for the schematic-design AI. Likely a parametric layout engine + rule engine, not diffusion/GAN.
2. **Requirements extraction:** Heavy form (floor count, units, building uses, zoning district, lot type, lot dimensions, core, unit mix with $/sqft) ([Screen by Screen](https://arkdesign.ai/screen-by-screen/)).
3. **Validation/dialog:** Continuous compliance feedback while editing; not conversational. No documented "explain why" feature.
4. **Compliance:** **Strongest US/NYC zoning depth in the field** — pre-loaded with US/NYC code templates. Outside US, user must manually enter setbacks/heights/coverage. No Vastu/Feng Shui.
5. **Transparency:** Area summaries; PDF + Revit export. Rationale per move: not exposed.
6. **What we could adopt:** Pre-loaded jurisdiction templates as a library; the "edit and continuously re-check" loop; clean unit-mix configuration UI.
7. **Sources:** [Ark home](https://arkdesign.ai/), [FAQ](https://arkdesign.ai/faq/), [Screen by Screen](https://arkdesign.ai/screen-by-screen/), [aec+tech profile](https://www.aecplustech.com/tools/arkdesign-ai), [aec+tech blog](https://www.aecplustech.com/blog/multi-family-mixed-use-design-through-ai-meet-arkdesign).

## Recent research (2022–2026)

### Rectilinear dissection / classical optimization

Representative threads: slicing trees, B*-trees, MIP/ILP formulations.

- **Slicing tree** is the foundational representation: recursive H/V dissection of a rectangle; each leaf is a room ([RG slicing tree](https://www.researchgate.net/publication/3893069_Slicing_tree_is_a_complete_floorplan_representation)).
- **B*-trees (Chang & Chang, 2000)** extended to non-slicing layouts with O(1) insert/delete; widely used in VLSI floorplanning, less in arch ([ACM DL](https://dl.acm.org/doi/10.1145/337292.337541)).
- **MIP/ILP for architecture** ([CAAD Futures 2005, Keatruangkamala & Sinapiromsaran](https://papers.cumincad.org/data/works/att/cf2005_1_38_111.content.pdf)): multi-objective MIP captures connectivity, fixed-room, boundary, non-overlap, and ratio constraints with binary variables. ILP scales poorly past medium instances — same limit we've hit.
- Modern ILP refinement ([Vielma et al., GA Tech](https://www2.isye.gatech.edu/~sdey30/LayoutFormulationCuts.pdf)) gives stronger formulations and tighter cuts.
- **Implication for BuildFlow:** these methods are well understood, deterministic, and explainable — exactly what we want. Combine with our existing CSP propagators and use as a fallback when ML proposals fail validation.
- For room-level CSP propagation specifics, a clear practitioner walkthrough exists at [pvigier's blog](https://pvigier.github.io/2022/11/05/room-generation-using-constraint-satisfaction.html).
- Survey: [Weber, Mueller, Reinhart 2022 "Automated floorplan generation in architectural design: a review"](https://www.sciencedirect.com/science/article/abs/pii/S0926580522002588) — categorizes bottom-up / top-down / referential and calls for hybrid methods.

### Constraint-based / CSP-SAT

- Classical reference: [Constraint Satisfaction Techniques for Spatial Planning, Charman](https://link.springer.com/chapter/10.1007/978-3-642-84392-1_13) — formalized rectangle-packing-with-adjacency as CSP.
- Tooling: SAT-based CSP encoders ([Sugar / CSPSAT](https://cspsat.gitlab.io/sugar/)), Google OR-Tools CP-SAT ([OR-Tools](https://developers.google.com/optimization/cp)).
- Floor-plan-specific CSP: each cell/room represented as variable; constraints propagate via AC-3, MAC, or via SAT encoding; objective is a satisfying *and* well-shaped layout.
- **Key strength vs ML:** explainability — every failed assignment can be traced to a violated constraint, which is the exact UX wedge Finch3D ships.
- **Key weakness:** scaling. Beyond ~30 rooms or non-rectilinear cases, CSP-SAT alone gets impractical without strong heuristics or hybrid ML proposers.
- **Implication for BuildFlow:** our current H_DIRECTIONAL / H_BETWEEN / H_CONNECTS_ALL propagators are on the right track. The honest gap is graceful infeasibility reporting (which Phase 7 partially addressed for connects_all).

### Graph-constrained generative (House-GAN, Graph2Plan, etc.)

- **House-GAN ([Nauata et al., ECCV 2020](https://ennauata.github.io/housegan/page.html)):** input = bubble diagram (graph of rooms + adjacency); output = relational GAN-generated room masks. Per-room generators with cross-room message passing.
- **House-GAN++ ([CVPR 2021](https://ennauata.github.io/houseganpp/page.html)):** iterative refinement (output of round N feeds into round N+1) + GT-conditioning training trick + meta-optimization at inference. Beat prior SOTA and competitive with human architects.
- **Graph2Plan ([Hu et al., SIGGRAPH 2020](https://arxiv.org/abs/2004.13204)):** GNN over a layout graph + CNN over building boundary → raster plan → refined boxes. Uses RPLAN dataset (80k annotated plans). Adds user-in-the-loop sparse constraints.
- **Common dataset:** RPLAN (80k Chinese residential plans). Newer alternatives: MSD ([ECCV 2024](https://github.com/caspervanengelenburg/msd)), ResPlan ([2025, 17k plans](https://arxiv.org/html/2508.14006v1)).
- **Limitations of GAN era:** discrete + continuous geometry hard to enforce together; non-Manhattan boundaries break things; iteration is slow.

### Diffusion-based generation

- **HouseDiffusion ([Shabani et al., CVPR 2023](https://arxiv.org/abs/2211.13287)):** diffusion over 2D vector coordinates of room/door corners, with both continuous noise denoising and a discrete coord objective enforcing parallelism, orthogonality, corner sharing. Transformer backbone with attention masks driven by the input graph constraint. **+67% diversity, +32% compatibility vs House-GAN++**. Introduced Non-Manhattan-RPLAN benchmark.
- **MaskPLAN ([Zhang, CVPR 2024](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhang_MaskPLAN_Masked_Generative_Layout_Planning_from_Partial_Input_CVPR_2024_paper.pdf)):** Graph-structured Masked AutoEncoders. Trains with stochastic masking of layout attributes; at inference, takes *partial* user input as a global conditional prior and completes it. Explicitly built for "user has incomplete idea" — the realistic design workflow.
- **FloorplanDiffusion ([J. Const Eng & Mgmt 2024](https://www.sciencedirect.com/science/article/abs/pii/S0926580524001109)):** multi-condition two-stage diffusion. FID 8.36 on RPLAN — 74.2% improvement over baseline.
- **GSDiff ([2025](https://wutomwu.github.io/publications/2025-GSDiff/paper.pdf)):** geometry-and-semantics-aware vector floorplan diffusion.
- **ResLAB / "Stable diffusion + ControlNet" ([Wang et al. 2025](https://www.sciencedirect.com/science/article/pii/S2666165925000912)):** uses NL text + SD + ControlNet; introduces a knowledge-graph-to-NL pipeline for design rules.

### LLM-guided generation

- **Tell2Design ([Leng et al., ACL 2023, Area Chair Award](https://arxiv.org/abs/2311.15941)):** 80k plans paired with NL instructions; T5-based seq2seq baseline that converts text → spatially-constrained floor plan. The dataset is now the *de facto* benchmark for text-to-plan eval.
- **HouseTune ([2024](https://arxiv.org/html/2411.12279v4)):** **two-stage LLM + diffusion.** Stage 1: GPT-4o with chain-of-thought generates a JSON layout (rooms, sizes, doors). Stage 2: conditional diffusion refines it with "dual-phase conditioning" (during noise add and denoise). +28% diversity, +79% compatibility vs HouseDiffusion; 65% user approval.
- **ChatHouseDiffusion ([Qin & He, Oct 2024](https://arxiv.org/abs/2410.11908)):** LLM parses NL → structured JSON; Graphormer encodes topology; diffusion generates. **Iterative, conversational editing — the closest published analog to a chat-first floor-plan workflow.** Higher IoU than competitors; supports localized adjustments without full redesign.
- **ChatDesign ([CAADRIA 2024](https://caadria2024.org/wp-content/uploads/2024/04/166-CHATDESIGN.pdf)):** bootstrapping generative floor plans via chat.
- **Trend:** LLM owns the requirements-extraction + dialog layer; diffusion/GAN owns geometry. This split is now standard.

### BIM-aware generation

- **Direct IFC-aware generation is rare in the literature.** Most work generates 2D vector plans, then leaves IFC mapping as a post-step (a real productization gap).
- **Building Information Graphs (BIGs) ([Cambridge DCE 2024](https://www.cambridge.org/core/journals/data-centric-engineering/article/building-information-graphs-bigs-remodeling-building-information-for-learning-and-applications/ED0C0B75DA5D10EA87B206FCAF5FAA0C)):** proposal to remodel BIM data into graphs that ML models can learn over.
- **buildingSMART** has explicitly stated intent to revise IFC for AI compatibility, with IFC4.3 ADD2 in 2024 and IFC5 in development ([buildingSMART](https://technical.buildingsmart.org/standards/ifc/), [systematic review](https://www.mdpi.com/2076-3417/13/23/12560)).
- **Practical IFC-bridging examples:** Hypar JSON → IFC export; auto-generation of structural IFC from architectural IFC ([MDPI 2024](https://www.mdpi.com/2075-5309/14/8/2475)).
- **Honest assessment:** generative-output → IFC is mostly "plumbing" today, not algorithmically novel. BuildFlow's existing IFC parser pipeline is an asset; tightly closing the loop (generate → IFC → BOQ → re-validate) is where we can lead.

## Gap analysis

| Capability | BuildFlow today | Field standard | Gap severity | Strategic implication |
|---|---|---|---|---|
| Free-text requirements ingestion | Partial (workflow nodes) | LLM-parsed JSON spec (HouseTune, ChatHouseDiffusion, Maket) | **CRITICAL** | Without conversational requirements, we lose to Maket on owner UX and to Forma on architect UX. |
| Site / GIS context auto-pull | Manual upload | Auto from 25k+ sources (Archistar, Forma) | **IMPORTANT** | Big perceived-value moat. Even partial auto-pull (Indian municipal GIS) would differentiate us locally. |
| Constraint-driven solver | CSP propagators (H_DIRECTIONAL, H_BETWEEN, H_CONNECTS_ALL) | Finch Graph; Ark constraint engine; classical CSP/MIP | **NICE-TO-HAVE** (we're already on track) | Double down — this is our moat candidate. |
| Generative diversity (variants per spec) | Limited | Hundreds-to-thousands per run (Archistar, TestFit, Forma) | **IMPORTANT** | Need to ship "show me 20 variants" UX even if backend is parametric. |
| Validation / "why infeasible" dialog | Partial (Phase 7 connects_all fallback) | Only Finch3D documents this; everyone else is silent | **CRITICAL OPPORTUNITY** | Single most defensible UX wedge. Lean in. |
| Per-design rationale ("why I moved kitchen south") | None | Essentially nobody ships this | **CRITICAL OPPORTUNITY** | Pair LLM commentary with our CSP trace → unique product. |
| Regional code compliance | None packaged | Strong: Archistar (AU/NA), Ark (US/NYC), Forma (zoning context) | **CRITICAL for Indian market** | Ship IS-1200/NBC-2016 + state DCRs as templates. |
| Vastu / cultural rules | None | Only consumer scoring apps (Grihafy) | **NICE-TO-HAVE / DIFFERENTIATOR** | Indian residential is the obvious wedge — score + suggest. |
| Microclimate / wind / daylight ML surrogates | None | Forma is best-in-class | **NICE-TO-HAVE** | High-effort, low marginal value vs core gaps. |
| BIM/IFC round-trip | We parse IFC → BOQ already; generation→IFC unclear | Hypar IFC export; Forma Revit; Ark Revit/PDF | **IMPORTANT** | Closing generate→IFC→BOQ loop is our unique full-stack story. |
| Conversational edit loop ("widen the hallway") | None | Maket is the gold standard; ChatHouseDiffusion is the research analog | **CRITICAL** | Should ship in next 2 quarters. |
| Multi-criterion compare grid | Partial | TestFit, Forma, Archistar | **IMPORTANT** | Ranked deal-cards UI is table stakes. |
| Per-jurisdiction rule library | None | Ark/Archistar | **IMPORTANT** | Curated state-DCR library is a moat in India. |

## What we could adopt — ranked

1. **"Why this is infeasible" diagnostic, surfaced from our CSP trace.** Highest impact, low-to-moderate effort. We already log violated propagators; expose them in plain English. Closes the single biggest UX gap in the entire competitive set. (Borrows from Finch3D + classical CSP.)
2. **Chat-first edit loop** ("move the kitchen south", "widen the hallway"). Maket + ChatHouseDiffusion show the pattern. Map NL → CSP delta → re-solve. Medium effort; massive owner-segment lift.
3. **LLM-front-end requirements extractor → structured JSON spec** that drives our CSP solver. HouseTune-style, but solver-backed. We avoid the diffusion stack while gaining LLM accessibility.
4. **Rule library per Indian jurisdiction (NBC-2016, IS-1200, state DCRs)**, packaged as constraint templates. Direct play against Ark's US/NYC moat — no one owns India.
5. **Vastu scoring + soft-constraint mode** (entrance direction, kitchen quadrant, master bedroom orientation). Lean into Indian residential. Trivially adds defensibility nobody else has at our level.
6. **"Show me N variants and rank by KPI" UX** (FAR, daylight, BOQ cost, Vastu score). Direct copy of TestFit/Archistar/Forma — table stakes.
7. **Auto-pull of site context** (parcel polygon, setbacks, allowable FSI from municipal data where available). Even a curated 5-city seed beats nothing.
8. **"Refine around my favorite"** (TestFit-style local search after pick). Very cheap to ship on top of our CSP — perturb constraints, re-solve.
9. **Component-wise / partial-input completion** (MaskPLAN paradigm). User sketches 3 rooms; we complete the rest. Higher effort; major architect-segment unlock.
10. **IFC-out from generated layouts** to close the generate→IFC→BOQ loop. We already own the IFC→BOQ side; closing the front end makes us the only end-to-end vendor.

## What we should NOT chase

1. **A diffusion model from scratch.** HouseDiffusion / HouseTune / GSDiff are 2-3 years and 1-3 PhDs of work, and they don't solve the actual user problem (rationale + compliance). Use LLM + CSP; revisit diffusion only if we have proprietary plan datasets to fine-tune on.
2. **Photoreal rendering as a primary capability** (LookX territory). We already wire renderers in GN-003. Don't compete with diffusion-render shops on quality — keep it as a downstream node.
3. **Microclimate / wind / daylight ML surrogates.** Forma has a 5-year head start and Autodesk's distribution. Integrate via API or skip; do not rebuild.
4. **A Hypar-style "platform of arbitrary user functions."** It dilutes focus; Hypar 2.0's own retreat from this in favor of space planning is the cautionary tale.
5. **Trying to ship US-zoning depth like ArkDesign or Archistar.** They're 5+ years and a patent ahead in the US. Win India first; let US be later.
