import {
    compareEvaluations,
    computeIntervalObjectiveWeight,
    evaluateObjective,
    type ObjectiveEvaluation
} from '../shared/objectives/index.ts';
import type { CalendarDay, SharedOptimizationInput } from '../shared/types/index.ts';
import type { ILPModel } from './types.ts';

/**
 * Populates linear objective coefficients c_k for each interval variable y_k in the ILP model.
 */
export function populateILPObjectiveCoeffs(
    model: ILPModel,
    input: SharedOptimizationInput,
    enableLexicographic: boolean
): number[] {
    const totalCalDays = model.calendarDays.length;
    const coeffs = model.intervals.map(iv =>
        computeIntervalObjectiveWeight(iv, input.rules, totalCalDays, enableLexicographic)
    );
    model.objectiveCoeffs = coeffs;
    return coeffs;
}

export function evaluateILPCandidate(
    calendarDays: CalendarDay[],
    ptoDates: string[],
    input: SharedOptimizationInput,
    enableLexicographic: boolean,
    selectedICTDates: string[] = []
): ObjectiveEvaluation {
    return evaluateObjective(calendarDays, ptoDates, input, enableLexicographic, selectedICTDates);
}

export { compareEvaluations };
