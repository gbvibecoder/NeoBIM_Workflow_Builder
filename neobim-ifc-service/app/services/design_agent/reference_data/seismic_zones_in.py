"""IS 1893 (Part 1):2016 — seismic zone factors for Indian cities.

Source: IS 1893 (Part 1):2016, Annex E "Zone Factors of Some Important
Towns" + Figure 1 "Seismic Zones of India".

The four-zone classification (II / III / IV / V) replaces the older
five-zone scheme in IS 1893:1984. Zone I was deleted in the 2002
revision; the lowest seismic zone in current use is Zone II (Z = 0.10).

The :data:`IS_1893_ZONES` mapping is the single source of truth that the
BriefAnalyst's post-processing step uses to enrich
:class:`~app.services.design_agent.types.SiteContext.seismic_zone` from
``location_city``. A missing city → ``None`` (the LLM does NOT guess —
the structural engineer in Phase 2B falls back to a project-specific
geotechnical study).

Coverage
--------
~60 cities chosen to span every Indian state union territory and every
seismic zone, biased toward larger metropolitan markets (which dominate
NeoBIM's user base). Cities are stored lowercase + canonical English
spelling; the lookup helper lowercases / strips the input city to match.
For renamed cities the historical name is mapped to the same zone so
"bombay" / "mumbai" both resolve.
"""

from __future__ import annotations

from typing import Optional

from app.services.design_agent.types import SeismicZone


# ── Zone Factor Z per IS 1893 Table 3 ─────────────────────────────────


ZONE_FACTOR: dict[SeismicZone, float] = {
    "II": 0.10,
    "III": 0.16,
    "IV": 0.24,
    "V": 0.36,
}


# ── City → seismic zone mapping ───────────────────────────────────────


# Stored as lowercase keys. The lookup helper canonicalises input city
# names by .strip().lower() — that matches the format the BriefAnalyst
# emits (which itself emits lowercase city names by prompt instruction).
IS_1893_ZONES: dict[str, SeismicZone] = {
    # ── Zone V (Z = 0.36) — Very Severe ────────────────────────
    "srinagar": "V",
    "leh": "V",
    "kargil": "V",
    "guwahati": "V",
    "shillong": "V",
    "imphal": "V",
    "kohima": "V",
    "aizawl": "V",
    "agartala": "V",
    "itanagar": "V",
    "gangtok": "V",
    "bhuj": "V",
    "port blair": "V",
    "tezpur": "V",
    "jorhat": "V",
    "dibrugarh": "V",
    # ── Zone IV (Z = 0.24) — Severe ────────────────────────────
    "delhi": "IV",
    "new delhi": "IV",
    "noida": "IV",
    "gurgaon": "IV",
    "gurugram": "IV",
    "ghaziabad": "IV",
    "faridabad": "IV",
    "chandigarh": "IV",
    "amritsar": "IV",
    "ludhiana": "IV",
    "jalandhar": "IV",
    "patiala": "IV",
    "jammu": "IV",
    "dehradun": "IV",
    "shimla": "IV",
    "roorkee": "IV",
    "haridwar": "IV",
    "saharanpur": "IV",
    "patna": "IV",
    "darbhanga": "IV",
    "muzaffarpur": "IV",
    "siliguri": "IV",
    "darjeeling": "IV",
    "almora": "IV",
    # ── Zone III (Z = 0.16) — Moderate ─────────────────────────
    "mumbai": "III",
    "bombay": "III",
    "navi mumbai": "III",
    "thane": "III",
    "pune": "III",
    "nashik": "III",
    "aurangabad": "III",
    # Nagpur: Zone III per Maharashtra PWD design guidelines
    # (conservative interpretation of IS 1893 figure 1 boundary).
    "nagpur": "III",
    "kolkata": "III",
    "calcutta": "III",
    "howrah": "III",
    "asansol": "III",
    "chennai": "III",
    "madras": "III",
    "ahmedabad": "III",
    "vadodara": "III",
    "baroda": "III",
    "surat": "III",
    "rajkot": "III",
    "lucknow": "III",
    "kanpur": "III",
    "varanasi": "III",
    "prayagraj": "III",
    "allahabad": "III",
    "agra": "III",
    "meerut": "III",
    "bareilly": "III",
    "gorakhpur": "III",
    "bhopal": "III",
    # Indore: Zone III per IS 1893 (revised post-2002);
    # MP PWD and IIT Bombay design guidelines confirm.
    "indore": "III",
    "jabalpur": "III",
    "gwalior": "III",
    "ranchi": "III",
    "jamshedpur": "III",
    "dhanbad": "III",
    "bhubaneswar": "III",
    "cuttack": "III",
    "rourkela": "III",
    "goa": "III",
    "panaji": "III",
    "vasco": "III",
    "thiruvananthapuram": "III",
    "trivandrum": "III",
    "kochi": "III",
    "ernakulam": "III",
    "kozhikode": "III",
    "calicut": "III",
    "thrissur": "III",
    "mangalore": "III",
    "raipur": "III",
    "bilaspur": "III",
    "vijayawada": "III",
    "visakhapatnam": "III",
    "vishakhapatnam": "III",
    "tirupati": "III",
    # ── Zone II (Z = 0.10) — Low ──────────────────────────────
    "bangalore": "II",
    "bengaluru": "II",
    "mysore": "II",
    "mysuru": "II",
    "hyderabad": "II",
    "secunderabad": "II",
    "warangal": "II",
    "hubli": "II",
    "hubballi": "II",
    "belgaum": "II",
    "belagavi": "II",
    "coimbatore": "II",
    "madurai": "II",
    "salem": "II",
    "tiruchirappalli": "II",
    "trichy": "II",
    "jaipur": "II",
    "jodhpur": "II",
    "udaipur": "II",
    "ajmer": "II",
    "kota": "II",
}


def lookup_seismic_zone(city: Optional[str]) -> Optional[SeismicZone]:
    """Return the IS 1893 zone for an Indian city or ``None``.

    Canonicalisation: strips whitespace + lowercases. Returns ``None``
    when the city is missing, empty, or unrecognised — the BriefAnalyst
    leaves ``site_context.seismic_zone`` as ``None`` in those cases
    rather than guessing. The structural engineer in Phase 2B checks for
    ``None`` and either prompts the user or applies the worst-of-region
    default.
    """
    if not city:
        return None
    key = city.strip().lower()
    return IS_1893_ZONES.get(key)


def lookup_zone_factor(zone: Optional[SeismicZone]) -> Optional[float]:
    """Return Z (zone factor) for a seismic zone or ``None``."""
    if zone is None:
        return None
    return ZONE_FACTOR[zone]


__all__ = [
    "IS_1893_ZONES",
    "ZONE_FACTOR",
    "lookup_seismic_zone",
    "lookup_zone_factor",
]
