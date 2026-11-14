import type { CandidateBreakInterval } from '../shared/calendar/index.ts';
import type { CalendarDay, ILPConfig, SharedOptimizationInput } from '../shared/types/index.ts';

export interface ILPLinearConstraint {
    name: string;
    sense: '<=' | '>=' | '==';
    rhs: number;
    terms: Array<{ intervalId: number; coeff: number }>;
}

export interface ILPModel {
    calendarDays: CalendarDay[];
    workingDays: CalendarDay[];
    intervals: CandidateBreakInterval[];
    intervalsByStart: CandidateBreakInterval[][];
    availablePTO: number;
    minPTORequired: number;
    requiredWorkingDayIndices: number[];
    naturalQualifyingCount: number;
    naturalCategoryCounts: {
        short: number;
        medium: number;
        long: number;
        extended: number;
    };
    linearConstraints: ILPLinearConstraint[];
    objectiveCoeffs: number[];
}

export interface ILPSolverInternalResult {
    selectedDates: string[];
    status: 'optimal' | 'feasible' | 'infeasible' | 'timeout';
    isProvenOptimal: boolean;
    withinGap: boolean;
    nodesExplored: number;
    bestUpperBound: number;
    bestObjective: number;
}

export type { ILPConfig, SharedOptimizationInput };
