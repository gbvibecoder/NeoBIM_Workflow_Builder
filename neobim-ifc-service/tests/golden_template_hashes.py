"""Golden IFC content hashes for the 12 Tier-2 template builders.

Recorded in Phase 1 Task A as the byte-identity safety net for every
future refactor phase. Each value is the SHA-256 of the IFC content
produced by `build_ifc_from_building_model(<builder>())`, with the
HEADER `FILE_NAME(...)` timestamp line stripped (see `_content_hash`
in `tests/test_ifc_from_building_model_byte_identity.py`).

If a refactor is meant to be non-breaking and a hash here changes,
the refactor introduced a difference — investigate before committing.
If a hash change is *intentional* (a deliberate output change), the
new value must be re-recorded in the same commit with justification.
"""

from __future__ import annotations

GOLDEN_TEMPLATE_HASHES: dict[str, str] = {
    "build_1bhk_pune_duplex": "cff29a5b02d24f2d4d4706b65082e000e59338a9a88234005a097c8b1f8c1d8b",
    "build_1bhk_pune_house": "acd62820986ea874c20674b7d10ea8b8e2301eb616f4f86d9c55ea2437e1f8f6",
    "build_1bhk_pune_template": "cff29a5b02d24f2d4d4706b65082e000e59338a9a88234005a097c8b1f8c1d8b",
    "build_1bhk_pune_tower": "c5d99db3f925d2780973582477b85070b930edacf0a95d8b250cd8abf4ad2ef4",
    "build_2bhk_pune_duplex": "cc9a8aed0a022286feed15050dc5bd822a9b88b7de2b87eeecb70689ca561dff",
    "build_2bhk_pune_house": "6e252723e0c6b25b37c71134940e58fdeb811742a639e2f45ba7a227a34760c9",
    "build_2bhk_pune_template": "cc9a8aed0a022286feed15050dc5bd822a9b88b7de2b87eeecb70689ca561dff",
    "build_2bhk_pune_tower": "d6492d2b7dfa9295adec0d6fb1c0fd781ab9f776e2bf66039c5d64d671ee0131",
    "build_3bhk_pune_duplex": "50ea814e73545fefab14f82b6b5a8a87b5c7542863c5a269f5ee9a68c7aaf05f",
    "build_3bhk_pune_house": "d914e82f3f9c191ffa2a450872caea093c16584613166542b9dd36b72392da8c",
    "build_3bhk_pune_template": "50ea814e73545fefab14f82b6b5a8a87b5c7542863c5a269f5ee9a68c7aaf05f",
    "build_3bhk_pune_tower": "0330367ba75d2e4e70c66bc89dd3669330aa6dc690f79ab099b040805146dbe7",
}
