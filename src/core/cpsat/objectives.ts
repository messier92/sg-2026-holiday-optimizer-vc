import {
    compareEvaluations,
    computeIntervalObjectiveWeight,
    evaluateObjective,
    type ObjectiveEvaluation
} from '../shared/objectives/index.ts';
import type { CalendarDay, SharedOptimizationInput } from '../shared/types/index.ts';
import type { CPSATModel } from './types.ts';

export function assignCPSATObjectiveWeights(
    model: CPSATModel,
    input: SharedOptimizationInput,
    enableLexicographic: boolean
): void {
    const totalDays = model.calendarDays.length;
    for (const v of model.intervalVars) {
        v.objectiveWeight = computeIntervalObjectiveWeight(
            v.interval,
            input.rules,
            totalDays,
            enableLexicographic
        );
    }
}

export function evaluateCPSATSolution(
    calendarDays: CalendarDay[],
    ptoDates: string[],
    input: SharedOptimizationInput,
    enableLexicographic: boolean,
    selectedICTDates: string[] = []
): ObjectiveEvaluation {
    return evaluateObjective(calendarDays, ptoDates, input, enableLexicographic, selectedICTDates);
}

export { compareEvaluations };
