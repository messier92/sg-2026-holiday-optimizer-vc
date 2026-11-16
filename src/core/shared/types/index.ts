export type AlgorithmId = 'ilp' | 'cpsat' | 'dp' | 'greedy' | 'genetic';

export interface PublicHoliday {
    date: string;
    name: string;
}

export interface CalendarDay {
    index: number;
    date: string; // YYYY-MM-DD
    year: number;
    month: number; // 0-11
    dayOfMonth: number; // 1-31
    dayOfWeek: number; // 0 (Sun) - 6 (Sat)
    isWeekend: boolean;
    isPublicHoliday: boolean;
    holidayName?: string;
    isFixedOff: boolean; // isWeekend || isPublicHoliday
    isEligibleWorkingDay: boolean; // !isFixedOff
    workingDayIndex: number; // -1 if fixed off, else 0..M-1
    isBlackout: boolean;
    isRequiredPTO: boolean;
    isFixedICT?: boolean;
    isAdjacentToHoliday: boolean;
    isAdjacentToWeekend: boolean;
}

export type BreakCategoryName = 'short' | 'medium' | 'long' | 'extended';

export interface BreakCategoryRule {
    enabled: boolean;
    minDuration: number; // consecutive calendar days
    minCount: number;
    maxCount: number | null; // null = unlimited
}

export interface BreakDurationRules {
    short: BreakCategoryRule;
    medium: BreakCategoryRule;
    long: BreakCategoryRule;
    extended: BreakCategoryRule;
    allowOverlappingCategoryCounts: boolean;
}

export interface PTOAllocationRules {
    allowUnusedPTO: boolean;
    minPTOToAllocate: number;
    reservePTODays: number;
    maxConsecutivePTOWorkingDays: number | null; // null = unlimited
    allowPTOAdjacentToHolidays: boolean;
    allowPTOAdjacentToWeekends: boolean;
}

export interface BreakDistributionRules {
    minWorkingDaysBetweenBreaks: number;
    minCalendarDaysBetweenBreaks: number | null; // null = disabled
    evenlyDistributeBreaks: boolean;
    minNumberOfBreaks: number;
    maxNumberOfBreaks: number | null; // null = unlimited
}

export interface ProhibitedDateRange {
    id: string;
    startDate: string;
    endDate: string;
    label?: string;
}

export type RequiredDateRange = ProhibitedDateRange;
export type FixedICTPeriod = ProhibitedDateRange;

export interface DateRestrictions {
    blackoutDates: string[];
    requiredPTODates: string[];
    requiredDateRanges?: RequiredDateRange[];
    prohibitedDateRanges: ProhibitedDateRange[];
}

export interface ICTRules {
    enabled: boolean;
    annualICTQuota: number; // default 40 calendar days
    minICTDaysToAllocate: number; // default 0
    reserveICTDays: number; // default 0
    allowUnusedICTQuota: boolean; // default true
    allowMultipleICTPeriods: boolean; // default true
    minPeriodDuration: number; // default 1 calendar day
    maxPeriodDuration: number | null; // null = unlimited
    minNumberOfICTPeriods: number; // default 0
    maxNumberOfICTPeriods: number | null; // null = unlimited
    minCalendarDaysBetweenICTPeriods: number; // default 1 calendar day
    distributeICTThroughoutYear: boolean; // default false
    fixedICTPeriods: FixedICTPeriod[];
}

export interface ICTPeriod {
    periodNumber: number;
    startDate: string;
    endDate: string;
    startIndex: number;
    endIndex: number;
    duration: number; // inclusive calendar days
    workingDaysCovered: number;
    weekendDaysCovered: number;
    publicHolidayDaysCovered: number;
    isFixed: boolean;
    label?: string;
}

export type PrimaryObjective =
    | 'maximize_total_days_off'
    | 'maximize_qualifying_breaks'
    | 'maximize_extended_breaks'
    | 'maximize_pto_efficiency'
    | 'maximize_ict_utilization'
    | 'maximize_break_distribution'
    | 'combine_ict_with_pto_and_holidays'
    | 'minimize_pto_consumption';

export type SecondaryObjectiveKey =
    | 'prefer_longer_breaks'
    | 'prefer_more_frequent_breaks'
    | 'prefer_evenly_distributed_breaks'
    | 'minimize_consecutive_pto'
    | 'minimize_unused_pto'
    | 'maximize_total_days_off'
    | 'prefer_combining_ict_with_weekends'
    | 'prefer_combining_ict_with_holidays'
    | 'prefer_connecting_ict_with_pto'
    | 'avoid_concentrating_ict'
    | 'preserve_pto_for_non_ict';

export interface SecondaryObjectiveConfig {
    enabled: boolean;
    weight: number;
}

export type SecondaryObjectivesMap = Record<SecondaryObjectiveKey, SecondaryObjectiveConfig>;

export interface OptimizationObjectives {
    primary: PrimaryObjective;
    secondaries: SecondaryObjectivesMap;
}

export interface SharedOptimizationRules {
    allocation: PTOAllocationRules;
    ict: ICTRules;
    breakDuration: BreakDurationRules;
    distribution: BreakDistributionRules;
    restrictions: DateRestrictions;
    objectives: OptimizationObjectives;
}

export interface ILPConfig {
    timeLimitSeconds: number;
    optimalityGapTolerance: number; // e.g. 0.0 for exact, 0.05 for 5%
    enableLexicographic: boolean;
}

export interface CPSATConfig {
    timeLimitSeconds: number;
    numSearchWorkers: number;
    randomSeed: number;
    enableLexicographic: boolean;
}

export interface DPConfig {
    maxStateCount: number;
    enableMemoization: boolean;
    stateExplorationLimit: number;
}

export type GreedyRankingStrategy =
    | 'max_additional_days_off'
    | 'max_qualifying_break_duration'
    | 'max_qualifying_breaks'
    | 'best_marginal_efficiency';

export interface GreedyConfig {
    rankingStrategy: GreedyRankingStrategy;
}

export interface GeneticConfig {
    populationSize: number;
    maxGenerations: number;
    mutationRate: number;
    crossoverRate: number;
    elitismCount: number;
    randomSeed: number;
    enableEarlyStopping: boolean;
    earlyStoppingGenerations: number;
    showConvergenceProgress: boolean;
}

export interface AlgorithmConfigs {
    ilp: ILPConfig;
    cpsat: CPSATConfig;
    dp: DPConfig;
    greedy: GreedyConfig;
    genetic: GeneticConfig;
}

export interface SharedOptimizationInput {
    startDate: string;
    endDate: string;
    ptoAllowance: number;
    publicHolidays: PublicHoliday[];
    rules: SharedOptimizationRules;
}

export interface BreakDetail {
    startDate: string;
    endDate: string;
    startIndex: number;
    endIndex: number;
    duration: number; // consecutive calendar days
    ptoDates: string[];
    ptoUsed: number;
    ictDates: string[];
    ictUsed: number;
    weekendDays: number;
    publicHolidayDays: number;
    isQualifying: boolean;
    primaryCategory: BreakCategoryName | 'Uncategorized';
    matchedCategories: BreakCategoryName[];
}

export interface BreakCategoryCounts {
    short: number;
    medium: number;
    long: number;
    extended: number;
}

export interface ConstraintViolation {
    code: string;
    message: string;
    severity: 'hard' | 'soft';
    satisfied: boolean;
}

export interface ConstraintValidationResult {
    isValid: boolean; // true iff all hard constraints are satisfied
    hardConstraints: ConstraintViolation[];
    softPreferences: ConstraintViolation[];
}

export type OptimizationStatus =
    | 'optimal'
    | 'feasible'
    | 'infeasible'
    | 'timeout'
    | 'unknown'
    | 'error';

export type OptimalityGuarantee =
    | 'proven_optimal'
    | 'feasible_within_gap'
    | 'feasible_unproven'
    | 'heuristic'
    | 'infeasible'
    | 'none';

export interface ConvergencePoint {
    generation: number;
    bestFitness: number;
    averageFitness: number;
}

export interface OptimizationProgress {
    algorithmId: AlgorithmId;
    phase: string;
    percent: number;
    currentIteration?: number;
    maxIterations?: number;
    bestScore?: number;
    statesExplored?: number;
    convergenceHistory?: ConvergencePoint[];
    warning?: string;
}

export interface OptimizationResult {
    algorithmId: AlgorithmId;
    algorithmName: string;
    selectedPTODates: string[];
    totalPTOConsumed: number;
    availablePTOAllowance: number;
    remainingPTOAllowance: number;
    reservedPTODays: number;
    ictEnabled: boolean;
    selectedICTDates: string[];
    ictPeriods: ICTPeriod[];
    numberOfICTPeriods: number;
    annualICTAllowance: number;
    availableICTAllowance: number;
    reservedICTDays: number;
    totalICTConsumed: number;
    remainingICTAllowance: number;
    ictUtilization: number; // percentage 0..100 of available ICT quota used
    totalCalendarDaysOff: number; // calendar days in continuous breaks
    totalNonWorkingCalendarDays: number; // all weekends + PH + PTO + ICT in range
    numberOfQualifyingBreaks: number;
    longestContinuousBreak: number;
    breaks: BreakDetail[];
    qualifyingBreaks: BreakDetail[];
    continuousBreakDates: string[]; // all calendar dates belonging to active/qualifying breaks
    categoryCounts: BreakCategoryCounts;
    ptoEfficiency: number; // totalCalendarDaysOff / totalPTOConsumed (or 0 if 0 PTO)
    validation: ConstraintValidationResult;
    executionTimeMs: number;
    status: OptimizationStatus;
    optimalityGuarantee: OptimalityGuarantee;
    isExactOptimal: boolean;
    objectiveScore: number;
    primaryObjectiveScore: number;
    secondaryObjectiveScore: number;
    statusMessage: string;
    warnings: string[];
    convergenceHistory?: ConvergencePoint[];
    statesExplored?: number;
    configSignature?: string;
    completedAt: string;
}

export interface SolverOptions<TConfig> {
    input: SharedOptimizationInput;
    config: TConfig;
    onProgress?: (progress: OptimizationProgress) => void;
    signal?: AbortSignal;
}

export const ALGORITHM_METADATA: Record<
    AlgorithmId,
    {
        id: AlgorithmId;
        name: string;
        shortName: string;
        route: string;
        isExactCapable: boolean;
        summary: string;
        description: string;
    }
> = {
    ilp: {
        id: 'ilp',
        name: 'Integer Linear Programming (ILP)',
        shortName: 'ILP',
        route: '/algorithms/ilp',
        isExactCapable: true,
        summary: 'Exact mathematical programming using binary decision variables, linear constraints, LP relaxation bounds, and branch-and-bound.',
        description:
            'Formulates PTO allocation as a 0-1 Integer Linear Program over eligible working days and break intervals. Uses linear relaxation upper bounds and branch-and-bound pruning to find globally optimal allocations or prove infeasibility.'
    },
    cpsat: {
        id: 'cpsat',
        name: 'Constraint Programming (CP-SAT)',
        shortName: 'CP-SAT',
        route: '/algorithms/cpsat',
        isExactCapable: true,
        summary: 'Constraint satisfaction and optimization using Boolean variables, interval propagation, domain filtering, and multi-worker search.',
        description:
            'Models consecutive breaks, spacing rules, and category cardinality constraints using Boolean satisfiability and constraint propagation. Employs portfolio search workers with domain reduction and conflict-driven pruning.'
    },
    dp: {
        id: 'dp',
        name: 'Dynamic Programming (DP)',
        shortName: 'DP',
        route: '/algorithms/dp',
        isExactCapable: true,
        summary: 'Sequential day-by-day state transition optimization with memoization, dominance pruning, and backpointer reconstruction.',
        description:
            'Processes the calendar chronologically day-by-day, tracking remaining PTO, current continuous off-day streak, consecutive PTO streak, break spacing, and break counts. Reconstructs the optimal schedule via state backpointers.'
    },
    greedy: {
        id: 'greedy',
        name: 'Greedy Algorithm',
        shortName: 'Greedy',
        route: '/algorithms/greedy',
        isExactCapable: false,
        summary: 'Fast constructive heuristic that iteratively selects the highest-ranked PTO bridge or extension opportunity.',
        description:
            'Generates candidate PTO opportunities around weekends and Singapore public holidays, evaluates marginal gains on existing breaks, and iteratively commits the best valid candidate according to the chosen ranking strategy. Heuristic only—does not guarantee global optimality.'
    },
    genetic: {
        id: 'genetic',
        name: 'Genetic Algorithm (GA)',
        shortName: 'GA',
        route: '/algorithms/genetic',
        isExactCapable: false,
        summary: 'Evolutionary metaheuristic using population selection, crossover, mutation, elitism, and constraint repair.',
        description:
            'Evolves a population of binary PTO chromosomes across generations using tournament selection, crossover, mutation, and deterministic constraint repair. Seeded random number generation guarantees reproducible heuristic runs.'
    }
};

export function createDefaultICTRules(): ICTRules {
    return {
        enabled: false,
        annualICTQuota: 40,
        minICTDaysToAllocate: 0,
        reserveICTDays: 0,
        allowUnusedICTQuota: true,
        allowMultipleICTPeriods: true,
        minPeriodDuration: 1,
        maxPeriodDuration: null,
        minNumberOfICTPeriods: 0,
        maxNumberOfICTPeriods: null,
        minCalendarDaysBetweenICTPeriods: 1,
        distributeICTThroughoutYear: false,
        fixedICTPeriods: []
    };
}

export function createDefaultRules(): SharedOptimizationRules {
    return {
        allocation: {
            allowUnusedPTO: false,
            minPTOToAllocate: 0,
            reservePTODays: 0,
            maxConsecutivePTOWorkingDays: null,
            allowPTOAdjacentToHolidays: true,
            allowPTOAdjacentToWeekends: true
        },
        ict: createDefaultICTRules(),
        breakDuration: {
            short: { enabled: false, minDuration: 4, minCount: 0, maxCount: null },
            medium: { enabled: false, minDuration: 7, minCount: 0, maxCount: null },
            long: { enabled: false, minDuration: 10, minCount: 0, maxCount: null },
            extended: { enabled: false, minDuration: 14, minCount: 0, maxCount: null },
            allowOverlappingCategoryCounts: false
        },
        distribution: {
            minWorkingDaysBetweenBreaks: 14,
            minCalendarDaysBetweenBreaks: null,
            evenlyDistributeBreaks: false,
            minNumberOfBreaks: 0,
            maxNumberOfBreaks: null
        },
        restrictions: {
            blackoutDates: [],
            requiredPTODates: [],
            requiredDateRanges: [],
            prohibitedDateRanges: []
        },
        objectives: {
            primary: 'maximize_total_days_off',
            secondaries: {
                prefer_longer_breaks: { enabled: true, weight: 1.0 },
                prefer_more_frequent_breaks: { enabled: false, weight: 1.0 },
                prefer_evenly_distributed_breaks: { enabled: false, weight: 1.0 },
                minimize_consecutive_pto: { enabled: false, weight: 1.0 },
                minimize_unused_pto: { enabled: false, weight: 1.0 },
                maximize_total_days_off: { enabled: false, weight: 1.0 },
                prefer_combining_ict_with_weekends: { enabled: true, weight: 1.0 },
                prefer_combining_ict_with_holidays: { enabled: true, weight: 1.0 },
                prefer_connecting_ict_with_pto: { enabled: false, weight: 1.0 },
                avoid_concentrating_ict: { enabled: false, weight: 1.0 },
                preserve_pto_for_non_ict: { enabled: false, weight: 1.0 }
            }
        }
    };
}

export function createDefaultAlgorithmConfigs(): AlgorithmConfigs {
    return {
        ilp: {
            timeLimitSeconds: 10,
            optimalityGapTolerance: 0,
            enableLexicographic: true
        },
        cpsat: {
            timeLimitSeconds: 10,
            numSearchWorkers: 4,
            randomSeed: 42,
            enableLexicographic: true
        },
        dp: {
            maxStateCount: 50000,
            enableMemoization: true,
            stateExplorationLimit: 250000
        },
        greedy: {
            rankingStrategy: 'best_marginal_efficiency'
        },
        genetic: {
            populationSize: 100,
            maxGenerations: 500,
            mutationRate: 0.05,
            crossoverRate: 0.8,
            elitismCount: 5,
            randomSeed: 42,
            enableEarlyStopping: true,
            earlyStoppingGenerations: 50,
            showConvergenceProgress: true
        }
    };
}
