import type { FloorPlanProject } from "@/types/floor-plan-cad";
import type { PromptExpectation, ScoreReport } from "../types";
import { scoreCompleteness } from "./completeness";
import { scoreVastu } from "./vastu-independent";
import { scoreDims } from "./dims";
import { scorePositions } from "./positions";
import { scoreHallucinations } from "./hallucinations";
import { scoreGaps } from "./gaps";

export function scoreAll(project: FloorPlanProject, expectation: PromptExpectation): ScoreReport {
  const completeness = scoreCompleteness(project, expectation);
  const vastu = scoreVastu(project, expectation);
  const dims = scoreDims(project, expectation);
  const positions = scorePositions(project, expectation);
  const hallucinations = scoreHallucinations(project, expectation);
  const gaps = scoreGaps(project, expectation);

  const total = completeness.score + vastu.score + dims.score + positions.score + hallucinations.score + gaps.score;

  return {
    total,
    components: {
      completeness: completeness.score,
      vastu: vastu.score,
      dims: dims.score,
      positions: positions.score,
      hallucinations: hallucinations.score,
      gaps: gaps.score,
    },
    details: {
      completeness: completeness.details,
      vastu: vastu.details,
      dims: dims.details,
      positions: positions.details,
      hallucinations: hallucinations.details,
      gaps: gaps.details,
    },
  };
}

export { scoreCompleteness, scoreVastu, scoreDims, scorePositions, scoreHallucinations, scoreGaps };
