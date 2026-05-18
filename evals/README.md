# Eval Harness — Brief-to-IFC v3

## Briefs

8 curated test briefs in `briefs/`, one per supported archetype:

| File | Archetype | Context |
|------|-----------|---------|
| `l-shape-office.json` | office | L-shaped open office, 10m + 4m extension |
| `residential-2bhk-mumbai.json` | residential_2bhk | 700 sqft Mumbai 2BHK |
| `residential-3bhk-bangalore.json` | residential_3bhk | 1100 sqft Bangalore 3BHK |
| `gym-pune.json` | gym | 120 sqm fitness center |
| `exhibition-delhi.json` | exhibition | 6x6m trade show booth |
| `retail-mumbai.json` | retail | 35 sqm clothing store |
| `restaurant-bangalore.json` | restaurant | 60-seat restaurant, 80 sqm |
| `classroom-chennai.json` | classroom | 40-student classroom, 7x9m |

## Running

```bash
# Local spec-only mode (no LLM, no Railway — just validates TypeScript wiring)
npm run eval:local

# Full mode (calls Anthropic enricher + Railway builder — uses credits)
npm run eval:full
```

## Output

Results land in `evals/results/{timestamp}-summary.json` and `.md`.

## Regression gate

```bash
npx tsx scripts/regression-gate.ts
```

Compares latest eval to previous best, flags >10% regression on entity count.
