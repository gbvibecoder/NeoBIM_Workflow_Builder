/**
 * Sample-brief launcher.
 *
 * Five preset BriefSpecs the user can drop into the JSON tab with one
 * click — gives an instant "try v3 without writing anything" path.
 * Briefs are the same ones the eval harness runs against (single source
 * of truth: `src/features/brief-to-ifc/v3/evals/briefs/*.json`).
 *
 * Behind a small disclosure so it doesn't dominate the form for users
 * who have their own brief in hand. Default: collapsed.
 *
 * The JSON files together add ~58 KB to the page bundle. Acceptable for
 * a beta feature; users opt into the v3 surface explicitly via the
 * sidebar entry / dashboard card, so the cost is concentrated on
 * users who actually need it.
 */

"use client";

import { useState } from "react";

import smallOffice from "../evals/briefs/small-office.json";
import retailPopUp from "../evals/briefs/retail-pop-up.json";
import residentialBedroom from "../evals/briefs/residential-bedroom.json";
import restaurantCounter from "../evals/briefs/restaurant-counter.json";
import solPropertiesBooth from "../evals/briefs/sol-properties-booth.json";

interface SampleBrief {
  label: string;
  hint: string;
  spec: unknown;
}

const SAMPLES: SampleBrief[] = [
  {
    label: "Small office",
    hint: "5×5 m open-plan room · 4 desks, coffee bar, phone booth",
    spec: smallOffice,
  },
  {
    label: "Retail pop-up",
    hint: "6×6 m floor · 1 central display + 4 wall fixtures",
    spec: retailPopUp,
  },
  {
    label: "Bedroom",
    hint: "4×5 m residential bedroom · bed, dresser, planters",
    spec: residentialBedroom,
  },
  {
    label: "Restaurant counter",
    hint: "4×8 m cafe corner · counter, shelves, stools",
    spec: restaurantCounter,
  },
  {
    label: "Exhibition booth",
    hint: "15×15 m, 8 zones · central coffee hub, corner displays",
    spec: solPropertiesBooth,
  },
];

interface SampleBriefsProps {
  /** Called with the stringified JSON when the user picks a sample. */
  onSelect: (briefSpecJson: string) => void;
}

export function SampleBriefs({ onSelect }: SampleBriefsProps): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm font-medium text-zinc-700"
      >
        <span>Try a sample brief</span>
        <span className="text-zinc-400">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 p-3 sm:p-4">
          <p className="mb-3 text-xs text-zinc-500">
            One-click fill the BriefSpec JSON tab. Generates a real IFC
            against your monthly quota.
          </p>
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((sample) => (
              <button
                key={sample.label}
                type="button"
                onClick={() =>
                  onSelect(JSON.stringify(sample.spec, null, 2))
                }
                className="flex max-w-full flex-col items-start gap-0.5 rounded-md border border-zinc-300 bg-white px-3 py-2 text-left text-sm transition-colors hover:border-amber-400 hover:bg-amber-50"
              >
                <span className="font-medium text-zinc-800">{sample.label}</span>
                <span className="text-xs text-zinc-500">{sample.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
