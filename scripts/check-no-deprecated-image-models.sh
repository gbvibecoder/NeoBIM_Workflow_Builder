#!/usr/bin/env bash
#
# Block live model literals for deprecated image models.
#
# Allowed: comments, marketing copy, historical documentation, i18n strings.
# Blocked: actual API call parameters like   model: "dall-e-3"   or
#          model: "gpt-image-1"  (without the .5).
#
# Use OPENAI_IMAGE_MODEL from src/features/ai/services/image-generation.ts
# as the single source of truth instead.
#
# This guard runs in CI and on `npm run lint`. It prevents accidental
# re-introduction by AI assistants, copy-paste from old branches, or new
# contributors unaware of the migration.

set -euo pipefail

if grep -rn --include="*.ts" --include="*.tsx" \
   -E 'model:[[:space:]]*["'"'"'](dall-e-3|gpt-image-1)["'"'"']' \
   src/; then
  echo ""
  echo "❌ Live model literal references DALL-E 3 or bare gpt-image-1."
  echo "   Use OPENAI_IMAGE_MODEL from src/features/ai/services/image-generation.ts"
  echo "   See: temp_folder/gpt-image-1.5-migration-execution-prompt-2026-04-28.md"
  exit 1
fi

echo "✅ No deprecated image-model literal references."
