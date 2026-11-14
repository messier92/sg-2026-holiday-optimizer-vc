import type { CalendarDay, DPConfig, SharedOptimizationInput } from '../shared/types/index.ts';

export interface DPStateNode {
    dayIndex: number; // 0..N
    remPTO: number;
    curOffDays: number;
    curBreakPTO: number;
    curConsecPTO: number;
    workCooldown: number; // remaining working days required before next PTO break can start
    calCooldown: number; // remaining calendar days required before next PTO break can start
    qualifyingBreaks: number;
    shortCount: number;
    mediumCount: number;
    longCount: number;
    extendedCount: number;
    accObjective: number;
    totalBreakDaysOff: number;
    parent: DPStateNode | null;
    tookPTOOnPrevDay: boolean;
}

export interface DPComplexityEstimate {
    estimatedStatesPerDay: number;
    estimatedTotalStates: number;
    likelyToExceedLimits: boolean;
    warningMessage?: string;
    unsupportedNotes: string[];
}

export type { CalendarDay, DPConfig, SharedOptimizationInput };
