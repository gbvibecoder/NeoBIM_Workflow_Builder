"""Per-stage LLM orchestrators for the design agent.

Slice 2A.5 adds ``brief_analyst.py`` (Stage 1, BriefAnalysis output).
Slice 2A.6 adds ``program_architect.py`` (Stage 2, RoomProgram output).
Each stage is a pure function ``(inputs, llm_client) -> (output, metadata)``
so route handlers can compose / cache / parallelise as needed.
"""
