import type { CandidateBreakInterval } from '../shared/calendar/index.ts';
import type { CalendarDay, CPSATConfig, SharedOptimizationInput } from '../shared/types/index.ts';

export type BoolDomain = 0 | 1 | 2; // 0 = False, 1 = True, 2 = Unassigned {0, 1}

export interface CPSATIntervalVar {
    id: number;
    interval: CandidateBreakInterval;
    domain: BoolDomain;
    incompatibleIds: number[];
    objectiveWeight: number;
}

export interface CPSATModel {
    calendarDays: CalendarDay[];
    workingDays: CalendarDay[];
    selectedICTDates: string[];
    availableICT: number;
    minICTRequired: number;
    intervalVars: CPSATIntervalVar[];
    intervalsByWorkStart: number[][];
    intervalsCoveringWorkDay: number[][];
    availablePTO: number;
    minPTORequired: number;
    requiredWorkIndices: number[];
}

export type { CPSATConfig, SharedOptimizationInput };
