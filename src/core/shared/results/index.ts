import { analyzeBreaks, buildCalendarDays, extractICTPeriods } from '../calendar/index.ts';
import { evaluateObjective } from '../objectives/index.ts';
import {
    ALGORITHM_METADATA,
    type AlgorithmId,
    type CalendarDay,
    type ConvergencePoint,
    type OptimalityGuarantee,
    type OptimizationResult,
    type OptimizationStatus,
    type SharedOptimizationInput
} from '../types/index.ts';
import { validateAllocation } from '../validation/index.ts';

export interface BuildResultParams {
    algorithmId: AlgorithmId;
    selectedPTODates: string[];
    selectedICTDates?: string[];
    input: SharedOptimizationInput;
    calendarDays?: CalendarDay[];
    executionTimeMs: number;
    status: OptimizationStatus;
    optimalityGuarantee: OptimalityGuarantee;
    isExactOptimal: boolean;
    enableLexicographic?: boolean;
    statusMessage: string;
    warnings?: string[];
    convergenceHistory?: ConvergencePoint[];
    statesExplored?: number;
    configSignature?: string;
}

/**
 * Builds a complete, validated OptimizationResult object.
 * Enforces the strict requirement that a solution violating any hard constraint
 * is never presented as a valid optimal/feasible solution.
 */
export function buildOptimizationResult(params: BuildResultParams): OptimizationResult {
    const {
        algorithmId,
        input,
        executionTimeMs,
        enableLexicographic = true,
        warnings = [],
        convergenceHistory,
        statesExplored,
        configSignature
    } = params;

    const meta = ALGORITHM_METADATA[algorithmId];
    const days =
        params.calendarDays ??
        buildCalendarDays(
            input.startDate,
            input.endDate,
            input.publicHolidays,
            input.rules.restrictions,
            input.rules.ict
        );

    const uniqueSortedPTO = Array.from(new Set(params.selectedPTODates)).sort();
    const uniqueSortedICT = Array.from(new Set(params.selectedICTDates ?? [])).sort();
    const validation = validateAllocation(uniqueSortedPTO, input, days, uniqueSortedICT);

    let finalStatus = params.status;
    let finalGuarantee = params.optimalityGuarantee;
    let finalExact = params.isExactOptimal;
    let finalMessage = params.statusMessage;
    let finalPTO = uniqueSortedPTO;
    let finalICT = uniqueSortedICT;

    // Never allow a solution violating hard constraints to be presented as optimal or feasible
    if (!validation.isValid && (finalStatus === 'optimal' || finalStatus === 'feasible')) {
        finalStatus = 'infeasible';
        finalGuarantee = 'infeasible';
        finalExact = false;
        const failedMsgs = validation.hardConstraints
            .filter(c => !c.satisfied)
            .map(c => c.message)
            .join(' ');
        finalMessage = `Infeasible configuration: ${failedMsgs}`;
        finalPTO = [];
        finalICT = [];
    }

    // Never report exact optimality for heuristic algorithms or unproven statuses
    if (!meta.isExactCapable || finalStatus !== 'optimal' || finalGuarantee !== 'proven_optimal') {
        finalExact = false;
    }

    const availablePTO = Math.max(0, input.ptoAllowance - input.rules.allocation.reservePTODays);
    const totalPTOConsumed = finalPTO.length;
    const remainingPTOAllowance = Math.max(0, availablePTO - totalPTOConsumed);

    const ictRules = input.rules.ict;
    const ictEnabled = !!ictRules?.enabled;
    const annualICTAllowance = ictEnabled ? ictRules.annualICTQuota : 0;
    const reservedICTDays = ictEnabled ? ictRules.reserveICTDays : 0;
    const availableICTAllowance = ictEnabled
        ? Math.max(0, annualICTAllowance - reservedICTDays)
        : 0;
    const totalICTConsumed = finalICT.length;
    const remainingICTAllowance = Math.max(0, availableICTAllowance - totalICTConsumed);
    const ictUtilization =
        availableICTAllowance > 0
            ? Number(((totalICTConsumed / availableICTAllowance) * 100).toFixed(1))
            : 0;
    const ictPeriods = extractICTPeriods(days, finalICT, ictRules?.fixedICTPeriods ?? []);

    const { activeBreaks, qualifyingBreaks, categoryCounts, continuousBreakDates } = analyzeBreaks(
        days,
        finalPTO,
        input.rules.breakDuration,
        finalICT
    );

    const ptoSet = new Set(finalPTO);
    const ictSet = new Set(finalICT);
    const totalNonWorkingCalendarDays = days.filter(
        d => d.isFixedOff || ictSet.has(d.date) || (d.isEligibleWorkingDay && ptoSet.has(d.date))
    ).length;

    const evalScores = evaluateObjective(days, finalPTO, input, enableLexicographic, finalICT);
    const totalCalendarDaysOff = evalScores.totalCalendarDaysOff;
    const longestContinuousBreak = activeBreaks.reduce((m, b) => Math.max(m, b.duration), 0);
    const ptoEfficiency =
        totalPTOConsumed > 0 ? Number((totalCalendarDaysOff / totalPTOConsumed).toFixed(2)) : 0;

    return {
        algorithmId,
        algorithmName: meta.name,
        selectedPTODates: finalPTO,
        totalPTOConsumed,
        availablePTOAllowance: availablePTO,
        remainingPTOAllowance,
        reservedPTODays: input.rules.allocation.reservePTODays,
        ictEnabled,
        selectedICTDates: finalICT,
        ictPeriods,
        numberOfICTPeriods: ictPeriods.length,
        annualICTAllowance,
        availableICTAllowance,
        reservedICTDays,
        totalICTConsumed,
        remainingICTAllowance,
        ictUtilization,
        totalCalendarDaysOff,
        totalNonWorkingCalendarDays,
        numberOfQualifyingBreaks: qualifyingBreaks.length,
        longestContinuousBreak,
        breaks: activeBreaks,
        qualifyingBreaks,
        continuousBreakDates,
        categoryCounts,
        ptoEfficiency,
        validation,
        executionTimeMs: Number(Math.max(0.1, executionTimeMs).toFixed(2)),
        status: finalStatus,
        optimalityGuarantee: finalGuarantee,
        isExactOptimal: finalExact,
        objectiveScore: evalScores.combinedScore,
        primaryObjectiveScore: evalScores.primaryScore,
        secondaryObjectiveScore: evalScores.secondaryScore,
        statusMessage: finalMessage,
        warnings,
        convergenceHistory,
        statesExplored,
        configSignature,
        completedAt: new Date().toISOString()
    };
}
