import type {
    CalendarDay,
    ConvergencePoint,
    GeneticConfig,
    SharedOptimizationInput
} from '../shared/types/index.ts';

export type SeededRNG = () => number;

export interface Chromosome {
    genes: Uint8Array; // length M (eligible working days), 0 or 1
    fitness: number;
    primaryScore: number;
    secondaryScore: number;
    isValid: boolean;
}

export interface GARunContext {
    calendarDays: CalendarDay[];
    workingDays: CalendarDay[];
    selectedICTDates: string[];
    selectedICTSet: ReadonlySet<string>;
    allowedMask: Uint8Array; // 1 if working day i is allowed for PTO
    requiredMask: Uint8Array; // 1 if working day i is required PTO
    bridgePriorityIndices: number[]; // working day indices adjacent to holidays/weekends/ICT
    availablePTO: number;
    minPTORequired: number;
    input: SharedOptimizationInput;
}

export type { CalendarDay, ConvergencePoint, GeneticConfig, SharedOptimizationInput };
