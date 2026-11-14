import {
    analyzeBreaks,
    getMaxConsecutivePTORun,
    type CandidateBreakInterval
} from '../calendar/index.ts';
import type {
    BreakDetail,
    CalendarDay,
    SharedOptimizationInput,
    SharedOptimizationRules
} from '../types/index.ts';

export interface ObjectiveEvaluation {
    primaryScore: number;
    secondaryScore: number;
    combinedScore: number;
    totalCalendarDaysOff: number;
    qualifyingBreakCount: number;
    extendedBreakCount: number;
    ptoEfficiency: number;
    distributionScore: number;
}

/**
 * Computes a normalized break distribution score in [0, 100] measuring how evenly
 * breaks are spaced across the calendar range [0, totalDays - 1].
 */
export function computeBreakDistributionScore(
    breaks: BreakDetail[],
    totalCalendarDays: number
): number {
    if (breaks.length === 0 || totalCalendarDays <= 0) {
        return 0;
    }

    // Measure gaps: before first break, between consecutive breaks, and after last break
    const gaps: number[] = [];
    gaps.push(breaks[0].startIndex);
    for (let i = 0; i < breaks.length - 1; i++) {
        gaps.push(Math.max(0, breaks[i + 1].startIndex - breaks[i].endIndex - 1));
    }
    gaps.push(Math.max(0, totalCalendarDays - 1 - breaks[breaks.length - 1].endIndex));

    const meanGap = gaps.reduce((acc, g) => acc + g, 0) / gaps.length;
    const variance = gaps.reduce((acc, g) => acc + (g - meanGap) ** 2, 0) / gaps.length;
    const stdDev = Math.sqrt(variance);

    // Lower normalized stdDev means more uniform spacing across the date range
    const normalizedStd = totalCalendarDays > 0 ? stdDev / totalCalendarDays : 0;
    const uniformity = Math.max(0, 1 - normalizedStd * 2);

    // Reward having multiple well-spaced breaks up to a natural cadence
    const countFactor = Math.min(1, breaks.length / Math.max(1, Math.min(6, Math.ceil(totalCalendarDays / 45))));
    return Number(((uniformity * 70 + countFactor * 30)).toFixed(4));
}

/**
 * Evaluates both the primary objective and weighted secondary objectives for a candidate PTO set.
 */
export function evaluateObjective(
    calendarDays: CalendarDay[],
    ptoDates: Iterable<string>,
    input: SharedOptimizationInput,
    enableLexicographic = true
): ObjectiveEvaluation {
    const ptoSet = new Set(ptoDates);
    const { rules, ptoAllowance } = input;
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const ptoConsumed = ptoSet.size;

    const { activeBreaks, qualifyingBreaks, categoryCounts } = analyzeBreaks(
        calendarDays,
        ptoSet,
        rules.breakDuration
    );

    const totalCalendarDaysOff = activeBreaks.reduce((sum, b) => sum + b.duration, 0);
    const qualifyingBreakCount = qualifyingBreaks.length;
    const extendedBreakCount = categoryCounts.extended;
    const ptoEfficiency = ptoConsumed > 0 ? totalCalendarDaysOff / ptoConsumed : 0;
    const distributionScore = computeBreakDistributionScore(
        qualifyingBreaks.length > 0 ? qualifyingBreaks : activeBreaks,
        calendarDays.length
    );

    let primaryScore = 0;
    switch (rules.objectives.primary) {
        case 'maximize_total_days_off':
            primaryScore = totalCalendarDaysOff;
            break;
        case 'maximize_qualifying_breaks':
            primaryScore = qualifyingBreakCount;
            break;
        case 'maximize_extended_breaks':
            primaryScore = extendedBreakCount;
            break;
        case 'maximize_pto_efficiency':
            primaryScore = Number(ptoEfficiency.toFixed(6));
            break;
        case 'maximize_break_distribution':
            primaryScore = distributionScore;
            break;
        case 'minimize_pto_consumption':
            primaryScore = availablePTO - ptoConsumed;
            break;
    }

    // Secondary objectives
    const sec = rules.objectives.secondaries;
    let secondaryScore = 0;

    if (sec.prefer_longer_breaks.enabled) {
        const sumSq = activeBreaks.reduce((s, b) => s + b.duration * b.duration, 0);
        secondaryScore += sec.prefer_longer_breaks.weight * (sumSq * 0.1);
    }

    if (sec.prefer_more_frequent_breaks.enabled) {
        secondaryScore += sec.prefer_more_frequent_breaks.weight * (qualifyingBreakCount * 5 + activeBreaks.length * 2);
    }

    if (sec.prefer_evenly_distributed_breaks.enabled || rules.distribution.evenlyDistributeBreaks) {
        const w = sec.prefer_evenly_distributed_breaks.enabled
            ? sec.prefer_evenly_distributed_breaks.weight
            : 1.0;
        secondaryScore += w * (distributionScore * 0.5);
    }

    if (sec.minimize_consecutive_pto.enabled) {
        const maxConsec = getMaxConsecutivePTORun(calendarDays, ptoSet);
        secondaryScore -= sec.minimize_consecutive_pto.weight * (maxConsec * 3);
    }

    if (sec.minimize_unused_pto.enabled) {
        const unused = Math.max(0, availablePTO - ptoConsumed);
        secondaryScore -= sec.minimize_unused_pto.weight * (unused * 4);
    }

    if (sec.maximize_total_days_off.enabled) {
        secondaryScore += sec.maximize_total_days_off.weight * (totalCalendarDaysOff * 2);
    }

    // Canonical tie-breaking so equal primary + secondary scores still prefer more break days & efficiency
    secondaryScore += totalCalendarDaysOff * 0.01 + qualifyingBreakCount * 0.005 + ptoEfficiency * 0.001;
    secondaryScore = Number(secondaryScore.toFixed(6));

    const combinedScore = enableLexicographic
        ? Number((primaryScore * 100000 + secondaryScore).toFixed(6))
        : Number((primaryScore * 50 + secondaryScore).toFixed(6));

    return {
        primaryScore,
        secondaryScore,
        combinedScore,
        totalCalendarDaysOff,
        qualifyingBreakCount,
        extendedBreakCount,
        ptoEfficiency: Number(ptoEfficiency.toFixed(2)),
        distributionScore
    };
}

/**
 * Compares two ObjectiveEvaluations according to lexicographic or weighted mode.
 * Returns > 0 if a is better than b, < 0 if b is better than a, 0 if equal.
 */
export function compareEvaluations(
    a: ObjectiveEvaluation,
    b: ObjectiveEvaluation,
    enableLexicographic = true
): number {
    if (enableLexicographic) {
        if (Math.abs(a.primaryScore - b.primaryScore) > 1e-6) {
            return a.primaryScore - b.primaryScore;
        }
        return a.secondaryScore - b.secondaryScore;
    }
    return a.combinedScore - b.combinedScore;
}

/**
 * Computes the linear interval coefficient for ILP / CP-SAT interval variables.
 */
export function computeIntervalObjectiveWeight(
    interval: CandidateBreakInterval,
    rules: SharedOptimizationRules,
    totalCalendarDays: number,
    enableLexicographic = true
): number {
    let primaryPart = 0;
    switch (rules.objectives.primary) {
        case 'maximize_total_days_off':
            primaryPart = interval.calDuration;
            break;
        case 'maximize_qualifying_breaks':
            primaryPart = interval.isQualifying ? 1 : 0;
            break;
        case 'maximize_extended_breaks':
            primaryPart = interval.matchedCategories.includes('extended') ? 1 : 0;
            break;
        case 'maximize_pto_efficiency':
            primaryPart = interval.ptoCost > 0 ? interval.calDuration / interval.ptoCost : 0;
            break;
        case 'maximize_break_distribution': {
            const center = (interval.calStartIdx + interval.calEndIdx) / 2;
            const normPos = totalCalendarDays > 0 ? center / totalCalendarDays : 0.5;
            const interiorBonus = 1 - Math.abs(normPos - 0.5) * 0.5;
            primaryPart = (interval.isQualifying ? 10 : 2) * interiorBonus + interval.calDuration * 0.2;
            break;
        }
        case 'minimize_pto_consumption':
            primaryPart = -interval.ptoCost;
            break;
    }

    const sec = rules.objectives.secondaries;
    let secondaryPart = 0;

    if (sec.prefer_longer_breaks.enabled) {
        secondaryPart += sec.prefer_longer_breaks.weight * (interval.calDuration * interval.calDuration * 0.1);
    }
    if (sec.prefer_more_frequent_breaks.enabled) {
        secondaryPart += sec.prefer_more_frequent_breaks.weight * (interval.isQualifying ? 7 : 2);
    }
    if (sec.minimize_consecutive_pto.enabled) {
        secondaryPart -= sec.minimize_consecutive_pto.weight * (interval.ptoCost * 3);
    }
    if (sec.minimize_unused_pto.enabled) {
        secondaryPart += sec.minimize_unused_pto.weight * (interval.ptoCost * 4);
    }
    if (sec.maximize_total_days_off.enabled) {
        secondaryPart += sec.maximize_total_days_off.weight * (interval.calDuration * 2);
    }

    secondaryPart += interval.calDuration * 0.01 + (interval.isQualifying ? 0.005 : 0);

    return enableLexicographic ? primaryPart * 100000 + secondaryPart : primaryPart * 50 + secondaryPart;
}
