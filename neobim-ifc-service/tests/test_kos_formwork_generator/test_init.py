"""Tests for __init__.py — public exports + PR 1 boundary enforcement."""
from __future__ import annotations


class TestPublicAPI:
    def test_types_importable(self):
        from app.services.kos_formwork_generator import (
            BracingScheme,
            FormworkAuditTrail,
            FormworkCategory,
            FormworkContext,
            FormworkCustomQuoteReason,
            FormworkCustomQuoteRequest,
            FormworkGeneratorOutput,
            FormworkInput,
            FormworkOperatorReviewItem,
            FormworkOperatorReviewType,
            Tier1FormworkSummary,
            Tier2Bucket,
            Tier2BucketCustom,
            Tier2FormworkCategories,
            Tier3SKUType,
            Tier4SKUDetail,
            Tier5FormworkWallSegment,
            Tier6FormworkComponent,
        )
        assert FormworkInput is not None

    def test_exceptions_importable(self):
        from app.services.kos_formwork_generator import (
            FormworkConfigError,
            FormworkError,
            FormworkInputError,
            FormworkInvariantError,
        )
        assert issubclass(FormworkConfigError, FormworkError)
        assert issubclass(FormworkInputError, FormworkError)
        assert issubclass(FormworkInvariantError, FormworkError)

    def test_constants_importable(self):
        from app.services.kos_formwork_generator import (
            ASSUMPTIONS_MADE_DEFAULT,
            FIELD_RULE_BOOK_VERSION,
            FORMWORK_CALCULATION_VERSION,
            FORMWORK_SCHEMA_VERSION,
            FORMWORK_SKU_CATALOG,
            FORMWORK_SKU_CODES,
            PENDING_KARTHIK_DEFAULT,
            PIPELINE_VERSIONS_DEFAULT,
            POUR_RATE_DEFAULTS_M_PER_HR,
            POUR_RATE_MAX_M_PER_HR,
            SEISMIC_ZONE_DEFAULT,
            SKU_CATEGORY,
            SKU_DESCRIPTION,
            SKU_FRB_SOURCE,
            SKU_UNIT,
            WASTAGE_PERCENT_DEFAULT,
        )
        assert FORMWORK_SCHEMA_VERSION == "0.1.0"
        assert FORMWORK_CALCULATION_VERSION == "v0.1.0"
        assert len(FORMWORK_SKU_CATALOG) == 33

    def test_lookup_tables_importable(self):
        from app.services.kos_formwork_generator import BRACING_LOOKUP_TABLE
        assert len(BRACING_LOOKUP_TABLE) == 16

    def test_all_attribute_complete(self):
        """__all__ must include every public name."""
        import app.services.kos_formwork_generator as mod
        for name in mod.__all__:
            assert hasattr(mod, name), f"__all__ references missing attribute: {name}"

    def test_pr1_through_pr6_exports_present(self):
        """PR 6 SHIPPED — Stage B closure. All PR 1-6 named exports must be present."""
        import app.services.kos_formwork_generator as mod
        public = [n for n in dir(mod) if not n.startswith("_")]
        expected = [
            "generate_formwork",              # PR 5 orchestrator
            "format_formwork_output_json",    # PR 6 serializer
            "dict_to_panel_grid_mapper_output",  # PR 6 deserializer
            "dict_to_formwork_context",       # PR 6 deserializer
        ]
        for name in expected:
            assert name in public, f"PR 1-6 export missing: {name}"

    def test_no_post_pr6_exports_yet(self):
        """Post-5F (5G shop drawings, 5H Vamshi validation) symbols forbidden."""
        import app.services.kos_formwork_generator as mod
        public = [n for n in dir(mod) if not n.startswith("_")]
        forbidden = [
            # 5G — shop drawings
            "generate_shop_drawing", "build_shop_drawing_svg", "build_shop_drawing_pdf",
            # 5H — Vamshi validation
            "validate_against_vamshi", "vamshi_diff_report",
        ]
        for f in forbidden:
            assert f not in public, f"Post-PR-6 symbol leaked: {f}"


class TestExportedNamesCardinality:
    def test_at_least_30_public_names(self):
        """Sanity: many types + constants exported."""
        import app.services.kos_formwork_generator as mod
        assert len(mod.__all__) >= 30
