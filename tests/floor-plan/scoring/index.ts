import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { PromptExpectation, ScoreReport } from "../types";
import { scoreCompleteness } from "./completeness";
import { scoreVastu } from "./vastu-independent";
import { scoreDims } from "./dims";
import { scorePositions } from "./positions";
import { scoreHallucinations } from "./hallucinations";
import { scoreGaps } from "./gaps";
import { scoreRelational } from "./relational";
import { scoreMainEntrance } from "./main-entrance";
import { scoreHallway } from "./hallway";
import { scoreWindows } from "./windows";

export function scoreAll(project: FloorPlanProject, expectation: PromptExpectation): ScoreReport {
  const completeness = scoreCompleteness(project, expectation);
  const vastu = scoreVastu(project, expectation);
  const dims = scoreDims(project, expectation);
  const positions = scorePositions(project, expectation);
  const hallucinations = scoreHallucinations(project, expectation);
  const gaps = scoreGaps(project, expectation);
  const relational = scoreRelational(project, expectation);
  const main_entrance = scoreMainEntrance(project, expectation);
  const hallway = scoreHallway(project, expectation);
  const windows = scoreWindows(project, expectation);

  const total =
    completeness.score + vastu.score + dims.score + positions.score +
    hallucinations.score + gaps.score +
    relational.score + main_entrance.score + hallway.score + windows.score;

  return {
    total,
    components: {
      completeness: completeness.score,
      vastu: vastu.score,
      dims: dims.score,
      positions: positions.score,
      hallucinations: hallucinations.score,
      gaps: gaps.score,
      relational: relational.score,
      main_entrance: main_entrance.score,
      hallway: hallway.score,
      windows: windows.score,
    },
    details: {
      completeness: completeness.details,
      vastu: vastu.details,
      dims: dims.details,
      positions: positions.details,
      hallucinations: hallucinations.details,
      gaps: gaps.details,
      relational: relational.details,
      main_entrance: main_entrance.details,
      hallway: hallway.details,
      windows: windows.details,
    },
  };
}

export { scoreCompleteness, scoreVastu, scoreDims, scorePositions, scoreHallucinations, scoreGaps, scoreRelational, scoreMainEntrance, scoreHallway, scoreWindows };
