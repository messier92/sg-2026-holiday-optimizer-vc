import { analyzeBreaks, buildCalendarDays } from '../calendar/index.ts';
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
        buildCalendarDays(input.startDate, input.endDate, input.publicHolidays, input.rules.restrictions);

    const uniqueSortedPTO = Array.from(new Set(params.selectedPTODates)).sort();
    const validation = validateAllocation(uniqueSortedPTO, input, days);

    let finalStatus = params.status;
    let finalGuarantee = params.optimalityGuarantee;
    let finalExact = params.isExactOptimal;
    let finalMessage = params.statusMessage;
    let finalPTO = uniqueSortedPTO;

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
    }

    // Never report exact optimality for heuristic algorithms or unproven statuses
    if (!meta.isExactCapable || finalStatus !== 'optimal' || finalGuarantee !== 'proven_optimal') {
        finalExact = false;
    }

    const availablePTO = Math.max(0, input.ptoAllowance - input.rules.allocation.reservePTODays);
    const totalPTOConsumed = finalPTO.length;
    const remainingPTOAllowance = Math.max(0, availablePTO - totalPTOConsumed);

    const { activeBreaks, qualifyingBreaks, categoryCounts, continuousBreakDates } = analyzeBreaks(
        days,
        finalPTO,
        input.rules.breakDuration
    );

    const ptoSet = new Set(finalPTO);
    const totalNonWorkingCalendarDays = days.filter(
        d => d.isFixedOff || (d.isEligibleWorkingDay && ptoSet.has(d.date))
    ).length;

    const evalScores = evaluateObjective(days, finalPTO, input, enableLexicographic);
    const totalCalendarDaysOff = evalScores.totalCalendarDaysOff;
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
        totalCalendarDaysOff,
        totalNonWorkingCalendarDays,
        numberOfQualifyingBreaks: qualifyingBreaks.length,
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
