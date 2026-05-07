"""IS 875 (Part 3):2015 — wind zones for Indian cities.

Source: IS 875 (Part 3):2015, Annex A "Basic Wind Speed at Some
Important Cities/Towns" + Figure 1 "Basic Wind Speed (Vb in m/s)".

The code itself maps locations to a basic wind speed Vb in m/s. The
6-zone numbering (Zones 1–6 corresponding to 33 / 39 / 44 / 47 / 50 /
55 m/s) is a conventional grouping used in design guides and the
Indian structural-engineering community; the prompt's schema uses this
numbering on
:class:`~app.services.design_agent.types.SiteContext.wind_zone`.

The :data:`IS_875_ZONES` mapping is the single source of truth; the
BriefAnalyst's enrichment step uses it to populate ``wind_zone`` from
``location_city``. Unknown city → ``None`` (no guessing).

Zone numbering (Vb basic wind speed)
------------------------------------
- Zone 1: 33 m/s — generally inland Karnataka, parts of TN
- Zone 2: 39 m/s — much of central India, Maharashtra inland, parts of TN
- Zone 3: 44 m/s — most of Maharashtra coastal, Gujarat inland, parts of UP
- Zone 4: 47 m/s — Delhi NCR, Punjab, Haryana, parts of Odisha
- Zone 5: 50 m/s — coastal AP, coastal Odisha, Chennai, Kolkata
- Zone 6: 55 m/s — high-cyclone coastal regions (parts of Gujarat coast
  including Bhuj, parts of Andhra Pradesh and Odisha coastline)
"""

from __future__ import annotations

from typing import Optional


# ── Basic wind speed Vb (m/s) per zone ────────────────────────────────


VB_BY_ZONE: dict[int, int] = {
    1: 33,
    2: 39,
    3: 44,
    4: 47,
    5: 50,
    6: 55,
}


# ── City → wind zone mapping ─────────────────────────────────────────


# Stored as lowercase keys, same canonicalisation as the seismic table.
# Coverage: ~60 cities chosen to span every wind zone and overlap with
# the seismic table so a city resolves on both sides whenever possible.
IS_875_ZONES: dict[str, int] = {
    # ── Zone 1 (Vb = 33 m/s) ───────────────────────────────────
    "bangalore": 1,
    "bengaluru": 1,
    "mysore": 1,
    "mysuru": 1,
    "hubli": 1,
    "hubballi": 1,
    "belgaum": 1,
    "belagavi": 1,
    # ── Zone 2 (Vb = 39 m/s) ───────────────────────────────────
    "pune": 2,
    "nashik": 2,
    "aurangabad": 2,
    "nagpur": 2,
    "indore": 2,
    "ujjain": 2,
    "gwalior": 2,
    "raipur": 2,
    "bilaspur": 2,
    "ranchi": 2,
    "jamshedpur": 2,
    "hyderabad": 2,
    "secunderabad": 2,
    "warangal": 2,
    "ahmedabad": 2,
    "rajkot": 2,
    "vadodara": 2,
    "baroda": 2,
    "coimbatore": 2,
    "madurai": 2,
    "tiruchirappalli": 2,
    "trichy": 2,
    "salem": 2,
    "thiruvananthapuram": 2,
    "trivandrum": 2,
    "kochi": 2,
    "ernakulam": 2,
    "kozhikode": 2,
    "calicut": 2,
    "thrissur": 2,
    "mangalore": 2,
    "goa": 2,
    "panaji": 2,
    "vasco": 2,
    # ── Zone 3 (Vb = 44 m/s) ───────────────────────────────────
    "mumbai": 3,
    "bombay": 3,
    "navi mumbai": 3,
    "thane": 3,
    "surat": 3,
    "bhopal": 3,
    "jabalpur": 3,
    "lucknow": 3,
    "kanpur": 3,
    "varanasi": 3,
    "prayagraj": 3,
    "allahabad": 3,
    "agra": 3,
    "meerut": 3,
    "bareilly": 3,
    "gorakhpur": 3,
    "patna": 3,
    "muzaffarpur": 3,
    "darbhanga": 3,
    "jaipur": 3,
    "jodhpur": 3,
    "udaipur": 3,
    "ajmer": 3,
    "kota": 3,
    "vijayawada": 3,
    "tirupati": 3,
    # ── Zone 4 (Vb = 47 m/s) ───────────────────────────────────
    "delhi": 4,
    "new delhi": 4,
    "noida": 4,
    "gurgaon": 4,
    "gurugram": 4,
    "ghaziabad": 4,
    "faridabad": 4,
    "chandigarh": 4,
    "amritsar": 4,
    "ludhiana": 4,
    "jalandhar": 4,
    "patiala": 4,
    "jammu": 4,
    "dehradun": 4,
    "shimla": 4,
    "roorkee": 4,
    "haridwar": 4,
    "saharanpur": 4,
    "siliguri": 4,
    "rourkela": 4,
    # ── Zone 5 (Vb = 50 m/s) ───────────────────────────────────
    "chennai": 5,
    "madras": 5,
    "kolkata": 5,
    "calcutta": 5,
    "howrah": 5,
    "asansol": 5,
    "bhubaneswar": 5,
    "cuttack": 5,
    "puri": 5,
    "visakhapatnam": 5,
    "vishakhapatnam": 5,
    "kakinada": 5,
    # ── Zone 6 (Vb = 55 m/s) — high-cyclone coastal ─────────────
    "bhuj": 6,
    "kandla": 6,
    "porbandar": 6,
    "dwarka": 6,
    "okha": 6,
    "paradip": 6,
    "balasore": 6,
    "machilipatnam": 6,
    # ── NE / Himalayan / island regions ────────────────────────
    # NE India uses Zone 4 in IS 875 figure 1 — high but inland from
    # cyclones; coastal Andamans land in Zone 5+.
    "guwahati": 4,
    "shillong": 4,
    "imphal": 4,
    "kohima": 4,
    "aizawl": 4,
    "agartala": 4,
    "itanagar": 4,
    "gangtok": 4,
    "tezpur": 4,
    "jorhat": 4,
    "dibrugarh": 4,
    "srinagar": 4,
    "leh": 4,
    "kargil": 4,
    "almora": 4,
    "darjeeling": 4,
    "darbhanga": 3,
    "port blair": 5,
    "dhanbad": 2,
}


def lookup_wind_zone(city: Optional[str]) -> Optional[int]:
    """Return the IS 875 wind zone (1-6) for an Indian city or ``None``.

    Canonicalisation: strip + lowercase. Returns ``None`` for unknown /
    missing inputs — no guessing.
    """
    if not city:
        return None
    key = city.strip().lower()
    return IS_875_ZONES.get(key)


def lookup_basic_wind_speed_mps(zone: Optional[int]) -> Optional[int]:
    """Return Vb (m/s) for a wind zone or ``None``."""
    if zone is None:
        return None
    return VB_BY_ZONE.get(zone)


__all__ = [
    "IS_875_ZONES",
    "VB_BY_ZONE",
    "lookup_wind_zone",
    "lookup_basic_wind_speed_mps",
]
