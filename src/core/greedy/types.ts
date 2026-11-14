import type {
    CalendarDay,
    GreedyConfig,
    GreedyRankingStrategy,
    SharedOptimizationInput
} from '../shared/types/index.ts';

export interface GreedyCandidateOpportunity {
    dates: string[];
    ptoAdded: number;
    kind: 'holiday_bridge' | 'holiday_extension' | 'weekend_extension' | 'cluster_fill' | 'single_day';
    deltaCalendarDaysOff: number;
    resultingMaxBreakDuration: number;
    deltaQualifyingBreaks: number;
    marginalEfficiency: number;
    deltaObjectiveScore: number;
    helpsUnsatisfiedRequirement: boolean;
}

export type { CalendarDay, GreedyConfig, GreedyRankingStrategy, SharedOptimizationInput };
