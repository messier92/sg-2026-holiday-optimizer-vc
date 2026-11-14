import {
    analyzeBreaks,
    buildCalendarDays,
    generateCandidateBreakIntervals,
    type CandidateBreakInterval
} from '../shared/calendar/index.ts';
import { areIntervalsCompatible } from '../shared/constraints/index.ts';
import type { SharedOptimizationInput } from '../shared/types/index.ts';
import type { ILPLinearConstraint, ILPModel } from './types.ts';

/**
 * Constructs the 0-1 Integer Linear Programming model over eligible working days
 * and candidate break intervals.
 */
export function buildILPModel(input: SharedOptimizationInput): ILPModel {
    const { startDate, endDate, ptoAllowance, publicHolidays, rules } = input;
    const calendarDays = buildCalendarDays(startDate, endDate, publicHolidays, rules.restrictions);
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const minPTORequired = rules.allocation.allowUnusedPTO
        ? rules.allocation.minPTOToAllocate
        : availablePTO;

    const { workingDays, intervals: rawIntervals } = generateCandidateBreakIntervals(
        calendarDays,
        rules,
        availablePTO
    );

    const requiredWorkingDayIndices = workingDays
        .filter(w => w.isRequiredPTO)
        .map(w => w.workingDayIndex);

    // Filter out intervals that could never be part of a valid solution wrt required PTO dates:
    // If a required working day r is immediately adjacent to interval [a, b] (i.e. r == a - 1 or r == b + 1),
    // any valid solution that sets x_r = 1 would merge with [a, b], so [a, b] cannot be a maximal break interval
    // unless [a, b] itself includes r. Also filter intervals separated by fewer than minWorkingDaysBetweenBreaks
    // from a required working day outside the interval.
    const minWorkSpacing = Math.max(1, rules.distribution.minWorkingDaysBetweenBreaks);
    const validIntervals: CandidateBreakInterval[] = [];

    for (const iv of rawIntervals) {
        let conflictWithRequired = false;
        for (const rIdx of requiredWorkingDayIndices) {
            if (rIdx >= iv.workStartIdx && rIdx <= iv.workEndIdx) {
                continue; // Covered by this interval
            }
            // Distance in working days between rIdx and interval
            const dist =
                rIdx < iv.workStartIdx ? iv.workStartIdx - rIdx - 1 : rIdx - iv.workEndIdx - 1;
            if (dist < minWorkSpacing) {
                conflictWithRequired = true;
                break;
            }
        }
        if (!conflictWithRequired) {
            validIntervals.push({
                ...iv,
                id: validIntervals.length
            });
        }
    }

    const M = workingDays.length;
    const intervalsByStart: CandidateBreakInterval[][] = Array.from({ length: M }, () => []);
    for (const iv of validIntervals) {
        intervalsByStart[iv.workStartIdx].push(iv);
    }

    // Baseline natural qualifying breaks (with 0 PTO allocated)
    const zeroBreakAnalysis = analyzeBreaks(calendarDays, [], rules.breakDuration);
    const naturalQualifyingCount = zeroBreakAnalysis.qualifyingBreaks.length;
    const naturalCategoryCounts = { ...zeroBreakAnalysis.categoryCounts };

    // Build explicit linear constraints for inspection & validation
    const linearConstraints: ILPLinearConstraint[] = [];

    // 1. PTO Budget Upper Bound: sum(ptoCost_k * y_k) <= availablePTO
    linearConstraints.push({
        name: 'pto_budget_max',
        sense: '<=',
        rhs: availablePTO,
        terms: validIntervals.map(iv => ({ intervalId: iv.id, coeff: iv.ptoCost }))
    });

    // 2. PTO Budget Lower Bound: sum(ptoCost_k * y_k) >= minPTORequired
    if (minPTORequired > 0) {
        linearConstraints.push({
            name: 'pto_budget_min',
            sense: '>=',
            rhs: minPTORequired,
            terms: validIntervals.map(iv => ({ intervalId: iv.id, coeff: iv.ptoCost }))
        });
    }

    // 3. Required Working Days: for each required working day r, sum_{k covering r} y_k == 1
    for (const rIdx of requiredWorkingDayIndices) {
        linearConstraints.push({
            name: `required_pto_workday_${rIdx}`,
            sense: '==',
            rhs: 1,
            terms: validIntervals
                .filter(iv => iv.workStartIdx <= rIdx && rIdx <= iv.workEndIdx)
                .map(iv => ({ intervalId: iv.id, coeff: 1 }))
        });
    }

    // 4. Qualifying break count bounds
    if (rules.distribution.minNumberOfBreaks > 0) {
        linearConstraints.push({
            name: 'min_qualifying_breaks',
            sense: '>=',
            rhs: Math.max(0, rules.distribution.minNumberOfBreaks - naturalQualifyingCount),
            terms: validIntervals
                .filter(iv => iv.isQualifying)
                .map(iv => ({ intervalId: iv.id, coeff: 1 }))
        });
    }
    if (rules.distribution.maxNumberOfBreaks !== null) {
        linearConstraints.push({
            name: 'max_qualifying_breaks',
            sense: '<=',
            rhs: rules.distribution.maxNumberOfBreaks - naturalQualifyingCount,
            terms: validIntervals
                .filter(iv => iv.isQualifying)
                .map(iv => ({ intervalId: iv.id, coeff: 1 }))
        });
    }

    return {
        calendarDays,
        workingDays,
        intervals: validIntervals,
        intervalsByStart,
        availablePTO,
        minPTORequired,
        requiredWorkingDayIndices,
        naturalQualifyingCount,
        naturalCategoryCounts,
        linearConstraints,
        objectiveCoeffs: new Array(validIntervals.length).fill(0)
    };
}

export { areIntervalsCompatible };
