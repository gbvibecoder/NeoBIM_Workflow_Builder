"""Phase 2A Slice 2 — brief style classifier.

The classifier converts a :class:`DesignRequest` into a hybrid
:class:`BriefStyleWeights` distribution across three brief styles:

* **floor_plan** — explicit dimensions, room-with-size lists, plot
  geometry. Briefs that read like a tagged set of room areas.
* **narrative** — descriptive prose, mood / style words, intent verbs,
  cultural overlays. Briefs that read like a Pinterest board.
* **parametric** — numeric envelope (floors, BHK, sqft) and structured
  ``BriefForm`` fields. Briefs that read like a property listing.

Algorithm (single rule-based pass + LLM fallback for low-signal briefs)
----------------------------------------------------------------------
1. Concatenate every text source the request carries (``brief_text`` +
   pre-extracted ``brief_pdf_text``). PDF URL extraction lives in Slice
   2A.3; by the time the route handler reaches the classifier, the
   text is already in ``brief_pdf_text``.
2. Run three independent scoring functions over the text. Each returns
   ``(raw_score, signals_list)`` where ``signals_list`` is a short
   human-readable trace used to build the rationale.
3. If the total raw signal across all three is below
   :data:`LOW_SIGNAL_THRESHOLD`, hand off to the LLM tiebreaker
   (Slice 2A.4 wires in the real Anthropic call; Slice 2A.2 stubs it
   with a uniform-weight fallback).
4. Otherwise normalise the raw scores to a probability distribution,
   compute a confidence value combining concentration (how dominant
   the leading style is) and signal strength (how much evidence we
   have), and assemble a one-line rationale.

Determinism
-----------
The function is pure: same input → same output, no LLM call unless
total raw signal < ``LOW_SIGNAL_THRESHOLD``. Even the fallback path
is deterministic in Slice 2A.2 (returns a fixed uniform distribution).
This is critical for the route handler's idempotency contract — any
caching layer can key the classifier output on the request hash alone.

Tuning
------
The scoring constants below were tuned against the four R3 reference
distributions in the Phase 2A prompt within ±0.15 tolerance per weight.
The tuning approach: pick the smallest set of distinct signals whose
weighted scores reproduce the target weights, then verify on additional
edge cases (combined PDF + form + text, low-signal stub, deterministic
output). Scoring drift in production should be tracked via the
``signals_list`` traces — if a real-user brief produces a counter-
intuitive distribution, the rationale tells you which rules fired.
"""

from __future__ import annotations

import re
from typing import Optional

from app.services.design_agent.types import (
    BriefForm,
    BriefStyleWeights,
    DesignRequest,
)


# ─── Scoring constants (per-signal weights) ──────────────────────────


# Floor-plan signals
_ROOM_DIM_PAIR_SCORE: float = 2.0    # AxB next to a room word ("10x12 kitchen")
_PLOT_DIM_SCORE: float = 1.0         # AxB next to "plot"/"site"/"land"
_BARE_DIM_SCORE: float = 0.5         # AxB with no obvious context word

# Parametric signals
_BHK_SCORE: float = 2.0              # "2BHK" — strong Indian residential shorthand
_FORM_FIELD_SCORE: float = 2.5       # each explicitly-set BriefForm field
_FLOOR_COUNT_SCORE: float = 0.7      # "5 floors", "G+3"
_AREA_MENTION_SCORE: float = 0.7     # "1200 sqft", "120 sqm"
_ENVELOPE_DIM_SCORE: float = 0.7     # "30m diameter", "15m wide"
_BARE_METRIC_SCORE: float = 0.5      # "30m" with no descriptor (likely envelope)
_STRUCTURAL_KEYWORD_SCORE: float = 0.5  # "rcc frame", "steel structure"

# Narrative signals
_STYLE_WORD_SCORE: float = 1.5       # "modern", "futuristic"
_INTENT_PHRASE_SCORE: float = 1.0    # "natural light", "young couple"
_INTENT_SINGLE_WORD_SCORE: float = 0.7  # "spacious", "airy"
_BUILDING_TYPE_SCORE: float = 0.3    # "apartment", "office" — mild narrative

# Fallback / confidence parameters
LOW_SIGNAL_THRESHOLD: float = 0.5    # below this total raw, defer to LLM stub
SIGNAL_PLATEAU: float = 6.0          # raw-signal level at which confidence saturates


# ─── Word and phrase lists ───────────────────────────────────────────


# Style / aesthetic words. Strong narrative signals.
_STYLE_WORDS: frozenset[str] = frozenset(
    {
        "modern", "futuristic", "traditional", "minimalist", "minimalistic",
        "industrial", "rustic", "luxurious", "luxury", "contemporary",
        "vintage", "mediterranean", "bohemian", "scandinavian", "japanese",
        "tropical", "victorian", "colonial", "zen", "biophilic",
        "vastu", "feng-shui",
    }
)

# Multi-word intent / mood phrases. Searched as substrings (lowercase).
_INTENT_PHRASES: tuple[str, ...] = (
    "natural light", "open plan", "open-plan", "young couple",
    "joint family", "growing family", "single occupant", "passive solar",
    "art deco", "warehouse-style", "loft-style", "feng shui",
    "vastu compliant", "vastu-compliant", "double height", "double-height",
    "double-volume", "sky lobby", "sky-lobby",
)

# Single-word mood / intent words.
_INTENT_SINGLE_WORDS: frozenset[str] = frozenset(
    {
        "spacious", "airy", "cozy", "cosy", "elegant", "warm", "bright",
        "comfortable", "intimate", "serene", "peaceful", "dramatic",
        "stunning", "breathtaking", "imagine", "dream", "envision",
        "dreamy", "aesthetic",
    }
)

# Building-type words. Mild narrative signal.
_BUILDING_TYPE_WORDS: frozenset[str] = frozenset(
    {
        "apartment", "flat", "bungalow", "villa", "duplex", "penthouse",
        "studio", "townhouse", "tenement",
        "shop", "showroom", "warehouse", "hospital", "clinic",
        "school", "college", "hotel", "resort", "restaurant",
    }
)

# Room words used to classify AxB dim matches as room_dim_pair.
_ROOM_WORDS: tuple[str, ...] = (
    "kitchen", "living", "dining", "bedroom", "master bedroom",
    "bathroom", "bath", "toilet", "wc", "study", "lobby", "balcony",
    "store", "utility", "powder", "ward", "consultation", "operation",
    "icu", "classroom", "library", "auditorium", "showroom",
    "hall", "drawing room", "den", "puja", "pooja",
)

# Plot-context words for AxB dim matches.
_PLOT_WORDS: tuple[str, ...] = ("plot", "site", "land", "parcel", "footprint")

# Structural-system narrative shortcuts (parametric signal).
_STRUCTURAL_PHRASES: tuple[str, ...] = (
    "rcc frame", "rcc structure", "rcc-frame", "concrete frame",
    "steel frame", "steel structure", "steel-frame",
    "load bearing", "load-bearing", "masonry frame", "masonry structure",
    "composite frame",
)


# ─── Compiled regex patterns ─────────────────────────────────────────


# AxB dim — accepts ASCII 'x', uppercase 'X', or Unicode '×'.
# Optional foot-tick (' or ′) on either operand. Optional unit suffix.
_DIM_RE: re.Pattern[str] = re.compile(
    r"(\d+(?:\.\d+)?)\s*['′]?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*['′]?"
    r"(?:\s*(ft|feet|m|meters?|sqft|sq\.?\s*ft|sqm|sq\.?\s*m))?",
)

# "2BHK" / "2 BHK" / "2-BHK" — case-insensitive
_BHK_RE: re.Pattern[str] = re.compile(r"\b(\d+)[\s-]*BHK\b", re.IGNORECASE)

# Floor count — "5 floors", "5-storey", "G+3" (we capture only \d+)
_FLOOR_RE: re.Pattern[str] = re.compile(
    r"\b(\d+)[\s-]*(?:floor|storey|stories|story|level)s?\b", re.IGNORECASE
)

# G+N building shorthand — "G+3", "G+5"
_G_PLUS_N_RE: re.Pattern[str] = re.compile(r"\bG\s*\+\s*(\d+)\b", re.IGNORECASE)

# Area mention — sqft, sqm, square feet/meters
_AREA_RE: re.Pattern[str] = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*"
    r"(?:sqft|sq\.?\s*ft|sq\s*ft|sqm|sq\.?\s*m|sq\s*m|"
    r"square\s*feet|square\s*foot|square\s*meters?|square\s*meter)\b",
    re.IGNORECASE,
)

# Envelope dim with descriptor — "30m diameter", "15m tall"
_ENVELOPE_DIM_RE: re.Pattern[str] = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*m(?:eters?)?\s+"
    r"(?:diameter|wide|width|long|length|tall|height|deep|depth|across|"
    r"radius|high|setback|set\s*back)\b",
    re.IGNORECASE,
)

# Bare metric — "30m" with no descriptor. Used after envelope-dim
# extraction; positions inside an envelope-dim span are skipped to
# avoid double-counting.
_BARE_METRIC_RE: re.Pattern[str] = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*m(?:eters?)?\b", re.IGNORECASE
)


# ─── Helpers ──────────────────────────────────────────────────────────


def _collect_text(request: DesignRequest) -> str:
    """Return the searchable text — concat of brief_text + brief_pdf_text.

    ``brief_pdf_url`` requires extraction, which the route handler
    runs upstream of this function (Slice 2A.3). When the URL is
    present without pre-extracted text, the classifier sees only the
    free-text component.
    """
    parts: list[str] = []
    if request.brief_text:
        parts.append(request.brief_text)
    if request.brief_pdf_text:
        parts.append(request.brief_pdf_text)
    return "\n\n".join(parts)


def _form_signal_score(form: Optional[BriefForm]) -> tuple[float, list[str]]:
    """Score parametric signal coming from BriefForm.

    Counts only fields the user explicitly passed during construction
    (``model_fields_set``). Defaults that the user never touched do
    not count, so an empty ``BriefForm()`` produces zero parametric
    signal.
    """
    if form is None:
        return 0.0, []
    explicit_fields = sorted(form.model_fields_set)
    if not explicit_fields:
        return 0.0, []
    score = len(explicit_fields) * _FORM_FIELD_SCORE
    return score, [f"BriefForm: {len(explicit_fields)} explicit field(s) — {', '.join(explicit_fields)}"]


def _classify_dim_match(text_lower: str, span: tuple[int, int]) -> tuple[str, float]:
    """Look at ±40 chars around a dim match and decide its category."""
    s, e = span
    ctx_start = max(0, s - 40)
    ctx_end = min(len(text_lower), e + 40)
    context = text_lower[ctx_start:ctx_end]
    for word in _ROOM_WORDS:
        if word in context:
            return ("room_dim", _ROOM_DIM_PAIR_SCORE)
    for word in _PLOT_WORDS:
        if word in context:
            return ("plot_dim", _PLOT_DIM_SCORE)
    return ("bare_dim", _BARE_DIM_SCORE)


def _score_floor_plan(text: str) -> tuple[float, list[str]]:
    """Floor-plan signals: AxB dim patterns with room / plot context."""
    if not text:
        return 0.0, []
    text_lower = text.lower()
    score = 0.0
    signals: list[str] = []
    room_dim_count = 0
    plot_dim_count = 0
    bare_dim_count = 0
    for match in _DIM_RE.finditer(text):
        category, points = _classify_dim_match(text_lower, match.span())
        score += points
        if category == "room_dim":
            room_dim_count += 1
        elif category == "plot_dim":
            plot_dim_count += 1
        else:
            bare_dim_count += 1
    if room_dim_count:
        signals.append(f"{room_dim_count} room-dim pair(s)")
    if plot_dim_count:
        signals.append(f"{plot_dim_count} plot-dim pattern(s)")
    if bare_dim_count:
        signals.append(f"{bare_dim_count} bare AxB dim(s)")
    return score, signals


def _score_parametric(text: str, form: Optional[BriefForm]) -> tuple[float, list[str]]:
    """Parametric signals: BHK / floors / area / envelope dims / form fields."""
    score = 0.0
    signals: list[str] = []

    # Form-driven signal
    fs, fs_signals = _form_signal_score(form)
    score += fs
    signals.extend(fs_signals)

    if not text:
        return score, signals

    text_lower = text.lower()

    # BHK
    bhk_matches = _BHK_RE.findall(text)
    if bhk_matches:
        score += len(bhk_matches) * _BHK_SCORE
        signals.append(f"{len(bhk_matches)} BHK mention(s)")

    # Floor count
    floor_matches = _FLOOR_RE.findall(text) + _G_PLUS_N_RE.findall(text)
    if floor_matches:
        score += len(floor_matches) * _FLOOR_COUNT_SCORE
        signals.append(f"{len(floor_matches)} floor-count mention(s)")

    # Area mention
    area_matches = _AREA_RE.findall(text)
    if area_matches:
        score += len(area_matches) * _AREA_MENTION_SCORE
        signals.append(f"{len(area_matches)} area mention(s)")

    # Envelope dims with descriptor
    envelope_spans: list[tuple[int, int]] = []
    for m in _ENVELOPE_DIM_RE.finditer(text):
        envelope_spans.append(m.span())
    if envelope_spans:
        score += len(envelope_spans) * _ENVELOPE_DIM_SCORE
        signals.append(f"{len(envelope_spans)} envelope-dim mention(s)")

    # Bare metric (skip positions already inside envelope-dim spans)
    bare_metric_count = 0
    for m in _BARE_METRIC_RE.finditer(text):
        if any(s <= m.start() < e for s, e in envelope_spans):
            continue
        bare_metric_count += 1
    if bare_metric_count:
        score += bare_metric_count * _BARE_METRIC_SCORE
        signals.append(f"{bare_metric_count} bare metric(s)")

    # Structural keywords
    struct_hits = sum(1 for kw in _STRUCTURAL_PHRASES if kw in text_lower)
    if struct_hits:
        score += struct_hits * _STRUCTURAL_KEYWORD_SCORE
        signals.append(f"{struct_hits} structural phrase(s)")

    return score, signals


def _score_narrative(text: str) -> tuple[float, list[str]]:
    """Narrative signals: style / intent / mood words and phrases."""
    if not text:
        return 0.0, []
    score = 0.0
    signals: list[str] = []
    text_lower = text.lower()

    # Style words (deduped — repetition does not score)
    style_hits = {w for w in _STYLE_WORDS if re.search(rf"\b{re.escape(w)}\b", text_lower)}
    if style_hits:
        score += len(style_hits) * _STYLE_WORD_SCORE
        signals.append(f"style words: {sorted(style_hits)}")

    # Intent phrases (multi-word; deduped)
    intent_phrase_hits = {p for p in _INTENT_PHRASES if p in text_lower}
    if intent_phrase_hits:
        score += len(intent_phrase_hits) * _INTENT_PHRASE_SCORE
        signals.append(f"intent phrases: {sorted(intent_phrase_hits)}")

    # Single-word intents (deduped)
    intent_word_hits = {
        w for w in _INTENT_SINGLE_WORDS
        if re.search(rf"\b{re.escape(w)}\b", text_lower)
    }
    if intent_word_hits:
        score += len(intent_word_hits) * _INTENT_SINGLE_WORD_SCORE
        signals.append(f"intent words: {sorted(intent_word_hits)}")

    # Building-type words (deduped — mild narrative)
    btype_hits = {
        w for w in _BUILDING_TYPE_WORDS
        if re.search(rf"\b{re.escape(w)}\b", text_lower)
    }
    if btype_hits:
        score += len(btype_hits) * _BUILDING_TYPE_SCORE
        signals.append(f"building-type words: {sorted(btype_hits)}")

    return score, signals


def _compute_confidence(weights: tuple[float, float, float], total_raw: float) -> float:
    """Confidence ∈ [0, 1] combining concentration + signal strength.

    * **concentration** — how dominant is the leading style? Maps the
      max weight from [1/3, 1] linearly into [0, 1]. A perfectly
      uniform distribution (max = 1/3) → 0; a point-mass (max = 1) → 1.
    * **signal_strength** — how much raw evidence did we collect?
      Saturates at :data:`SIGNAL_PLATEAU` raw points so a brief with
      tons of signal doesn't artificially inflate confidence beyond
      what concentration warrants.

    The product is what the prompt's R3 example contrasts: a clean
    floor-plan brief lands at high concentration × high signal → 0.7+.
    A genuinely ambiguous brief (uniform-ish) lands at low
    concentration × moderate signal → ~0.3. The low-signal fallback
    yields 0 directly.
    """
    max_w = max(weights)
    concentration = max(0.0, (max_w - 1.0 / 3.0) / (2.0 / 3.0))
    signal = min(total_raw / SIGNAL_PLATEAU, 1.0)
    # Clamp to [0, 1]: ``concentration * signal`` can exceed 1.0 by a
    # ULP or two via float arithmetic when both factors round up at
    # the boundary, which trips Field(le=1.0) on BriefStyleWeights.
    return min(1.0, max(0.0, concentration * signal))


def _build_rationale(
    weights: tuple[float, float, float],
    fp_signals: list[str],
    nr_signals: list[str],
    pa_signals: list[str],
) -> str:
    """One-line human-readable explanation of the weight distribution.

    Format::

        "<dominant style> dominant; FP: <fp signals>; NR: <nr signals>;
        PA: <pa signals>."

    Truncates each style's signal list to the first 3 entries so the
    rationale stays readable in audit logs.
    """
    fp, nr, pa = weights
    style_label_for = ("floor-plan", "narrative", "parametric")
    weights_arr = (fp, nr, pa)
    max_idx = weights_arr.index(max(weights_arr))
    max_w = weights_arr[max_idx]
    if max_w >= 0.55:
        header = f"{style_label_for[max_idx]} dominant"
    else:
        header = f"hybrid ({style_label_for[max_idx]} leading)"
    parts = [header]
    if fp_signals:
        parts.append("FP: " + ", ".join(fp_signals[:3]))
    if nr_signals:
        parts.append("NR: " + ", ".join(nr_signals[:3]))
    if pa_signals:
        parts.append("PA: " + ", ".join(pa_signals[:3]))
    parts.append(
        f"weights=(fp={fp:.2f}, nr={nr:.2f}, pa={pa:.2f})"
    )
    return "; ".join(parts) + "."


def _llm_classify_fallback(request: DesignRequest) -> BriefStyleWeights:
    """LLM-tiebreaker stub for low-signal briefs.

    Slice 2A.2 ships a deterministic uniform-1/3 fallback with very
    low confidence so the route handler still returns a valid
    :class:`BriefStyleWeights` envelope and downstream stages can
    still proceed (they will simply favour the BriefAnalyst's own
    classification).

    Slice 2A.4 (LLM client) replaces the body of this function with a
    real Haiku-4.5 call: 1-shot prompt asking the model to classify
    the brief into one dominant style and emit a confidence value.
    The function signature stays stable so callers don't change.
    """
    # The 1.0 - (1/3 + 1/3) trick guarantees the three components sum
    # to *exactly* 1.0 in IEEE-754 arithmetic, dodging the
    # BRIEF_STYLE_WEIGHTS_NORMALIZED 1e-6 tolerance at the boundary.
    third = 1.0 / 3.0
    return BriefStyleWeights.build(
        {
            "floor_plan": third,
            "narrative": third,
            "parametric": 1.0 - 2.0 * third,
            "confidence": 0.10,
            "rationale": (
                "Insufficient rule-based signal "
                f"(< {LOW_SIGNAL_THRESHOLD:.2f}); uniform fallback. "
                "Slice 2A.4 will replace this with an LLM tiebreaker."
            ),
        }
    )


# ─── Public entry point ───────────────────────────────────────────────


def classify_brief(request: DesignRequest) -> BriefStyleWeights:
    """Classify a brief into hybrid (floor_plan, narrative, parametric) weights.

    Pure function. Same input ``DesignRequest`` always produces the
    same :class:`BriefStyleWeights`. The LLM fallback path
    (currently a stub) is only triggered when the rule-based total
    signal falls below :data:`LOW_SIGNAL_THRESHOLD`.

    Implementation note on PDF input: this function reads
    ``request.brief_pdf_text`` (already-extracted PDF text). If only
    ``request.brief_pdf_url`` is set, the route handler must extract
    the text first (Slice 2A.3 wires this) before calling here.
    """
    text = _collect_text(request)
    fp_score, fp_signals = _score_floor_plan(text)
    nr_score, nr_signals = _score_narrative(text)
    pa_score, pa_signals = _score_parametric(text, request.brief_form)

    total_raw = fp_score + nr_score + pa_score
    if total_raw < LOW_SIGNAL_THRESHOLD:
        return _llm_classify_fallback(request)

    # Normalise to a probability distribution. Computing the third
    # component as ``1 - sum_of_other_two`` ensures float-exact
    # closure to 1.0 (subject to the BRIEF_STYLE_WEIGHTS_NORMALIZED
    # 1e-6 tolerance).
    fp_w = fp_score / total_raw
    nr_w = nr_score / total_raw
    pa_w = 1.0 - fp_w - nr_w

    weights = (fp_w, nr_w, pa_w)
    confidence = _compute_confidence(weights, total_raw)
    rationale = _build_rationale(weights, fp_signals, nr_signals, pa_signals)

    return BriefStyleWeights.build(
        {
            "floor_plan": fp_w,
            "narrative": nr_w,
            "parametric": pa_w,
            "confidence": confidence,
            "rationale": rationale,
        }
    )


__all__ = [
    "classify_brief",
    "LOW_SIGNAL_THRESHOLD",
    "SIGNAL_PLATEAU",
]
