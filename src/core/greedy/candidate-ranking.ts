import { analyzeBreaks, getMaxConsecutivePTORun, isWorkingDayAllowedForPTO } from '../shared/calendar/index.ts';
import { computeBreakSpacings } from '../shared/constraints/index.ts';
import { evaluateObjective } from '../shared/objectives/index.ts';
import type { CalendarDay, GreedyRankingStrategy, SharedOptimizationInput } from '../shared/types/index.ts';
import type { GreedyCandidateOpportunity } from './types.ts';

/**
 * Checks if a partial/intermediate PTO set respects all incremental hard constraints
 * (budget, blackout/adjacency, max consecutive PTO, break spacing, and upper break count bounds).
 */
export function isPartialAllocationFeasible(
    calendarDays: CalendarDay[],
    candidatePTOSet: ReadonlySet<string>,
    input: SharedOptimizationInput,
    availablePTO: number
): boolean {
    if (candidatePTOSet.size > availablePTO) return false;

    const { rules } = input;
    if (rules.allocation.maxConsecutivePTOWorkingDays !== null) {
        if (
            getMaxConsecutivePTORun(calendarDays, candidatePTOSet) >
            rules.allocation.maxConsecutivePTOWorkingDays
        ) {
            return false;
        }
    }

    const { activeBreaks, qualifyingBreaks, categoryCounts } = analyzeBreaks(
        calendarDays,
        candidatePTOSet,
        rules.breakDuration
    );

    const spacings = computeBreakSpacings(activeBreaks, calendarDays);
    for (const sp of spacings) {
        if (!sp.involvesPTO) continue;
        if (sp.workingDaysBetween < rules.distribution.minWorkingDaysBetweenBreaks) {
            return false;
        }
        if (
            rules.distribution.minCalendarDaysBetweenBreaks !== null &&
            rules.distribution.minCalendarDaysBetweenBreaks > 0 &&
            sp.calendarDaysBetween < rules.distribution.minCalendarDaysBetweenBreaks
        ) {
            return false;
        }
    }

    if (
        rules.distribution.maxNumberOfBreaks !== null &&
        qualifyingBreaks.length > rules.distribution.maxNumberOfBreaks
    ) {
        return false;
    }

    for (const catKey of ['short', 'medium', 'long', 'extended'] as const) {
        const rule = rules.breakDuration[catKey];
        if (rule.enabled && rule.maxCount !== null && categoryCounts[catKey] > rule.maxCount) {
            return false;
        }
    }

    return true;
}

/**
 * Generates candidate PTO opportunities (1-day bridges/extensions and multi-day contiguous working clusters)
 * and evaluates each candidate's marginal effect on existing breaks.
 */
export function generateAndEvaluateGreedyCandidates(
    calendarDays: CalendarDay[],
    currentPTOSet: ReadonlySet<string>,
    remainingPTO: number,
    input: SharedOptimizationInput,
    availablePTO: number
): GreedyCandidateOpportunity[] {
    if (remainingPTO <= 0) return [];

    const { rules } = input;
    const workingDays = calendarDays.filter(d => d.isEligibleWorkingDay);
    const M = workingDays.length;

    const baseAnalysis = analyzeBreaks(calendarDays, currentPTOSet, rules.breakDuration);
    const baseEval = evaluateObjective(calendarDays, currentPTOSet, input, true);

    // Check if any minimum break count or category count is currently unsatisfied
    const needsQualifyingBreaks =
        baseAnalysis.qualifyingBreaks.length < rules.distribution.minNumberOfBreaks;
    const unsatisfiedCategories = (['short', 'medium', 'long', 'extended'] as const).filter(
        c =>
            rules.breakDuration[c].enabled &&
            baseAnalysis.categoryCounts[c] < rules.breakDuration[c].minCount
    );

    const candidateDateGroups: Array<{
        dates: string[];
        kind: GreedyCandidateOpportunity['kind'];
    }> = [];

    // 1. Single working day opportunities
    for (let i = 0; i < M; i++) {
        const w = workingDays[i];
        if (currentPTOSet.has(w.date) || !isWorkingDayAllowedForPTO(w, rules)) continue;
        const kind: GreedyCandidateOpportunity['kind'] =
            w.isAdjacentToHoliday && w.isAdjacentToWeekend
                ? 'holiday_bridge'
                : w.isAdjacentToHoliday
                  ? 'holiday_extension'
                  : w.isAdjacentToWeekend
                    ? 'weekend_extension'
                    : 'single_day';
        candidateDateGroups.push({ dates: [w.date], kind });
    }

    // 2. Contiguous multi-day working opportunities (2 up to min(remainingPTO, 10))
    const maxCluster = Math.min(
        remainingPTO,
        rules.allocation.maxConsecutivePTOWorkingDays ?? 10,
        10
    );
    for (let a = 0; a < M; a++) {
        if (!isWorkingDayAllowedForPTO(workingDays[a], rules)) continue;
        const newDates: string[] = [];
        for (let b = a; b < Math.min(M, a + maxCluster); b++) {
            const w = workingDays[b];
            if (!isWorkingDayAllowedForPTO(w, rules)) break;
            if (!currentPTOSet.has(w.date)) {
                newDates.push(w.date);
            }
            if (newDates.length >= 2 && newDates.length <= remainingPTO) {
                candidateDateGroups.push({
                    dates: [...newDates],
                    kind: 'cluster_fill'
                });
            }
        }
    }

    // Deduplicate candidate date groups by canonical key
    const seenKeys = new Set<string>();
    const evaluated: GreedyCandidateOpportunity[] = [];

    for (const group of candidateDateGroups) {
        const key = group.dates.join(',');
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);

        const nextSet = new Set(currentPTOSet);
        for (const d of group.dates) nextSet.add(d);

        if (!isPartialAllocationFeasible(calendarDays, nextSet, input, availablePTO)) {
            continue;
        }

        const nextAnalysis = analyzeBreaks(calendarDays, nextSet, rules.breakDuration);
        const nextEval = evaluateObjective(calendarDays, nextSet, input, true);

        const deltaCalendarDaysOff =
            nextEval.totalCalendarDaysOff - baseEval.totalCalendarDaysOff;
        const deltaQualifyingBreaks =
            nextAnalysis.qualifyingBreaks.length - baseAnalysis.qualifyingBreaks.length;
        const resultingMaxBreakDuration = nextAnalysis.activeBreaks.reduce(
            (m, b) => Math.max(m, b.duration),
            0
        );
        const ptoAdded = group.dates.length;
        const marginalEfficiency = ptoAdded > 0 ? deltaCalendarDaysOff / ptoAdded : 0;
        const deltaObjectiveScore = nextEval.combinedScore - baseEval.combinedScore;

        let helpsUnsatisfiedRequirement = false;
        if (needsQualifyingBreaks && deltaQualifyingBreaks > 0) {
            helpsUnsatisfiedRequirement = true;
        }
        for (const cat of unsatisfiedCategories) {
            if (nextAnalysis.categoryCounts[cat] > baseAnalysis.categoryCounts[cat]) {
                helpsUnsatisfiedRequirement = true;
            }
        }

        evaluated.push({
            dates: group.dates,
            ptoAdded,
            kind: group.kind,
            deltaCalendarDaysOff,
            resultingMaxBreakDuration,
            deltaQualifyingBreaks,
            marginalEfficiency,
            deltaObjectiveScore,
            helpsUnsatisfiedRequirement
        });
    }

    return evaluated;
}

/**
 * Ranks candidate PTO allocations according to the selected GreedyRankingStrategy.
 */
export function rankGreedyCandidates(
    candidates: GreedyCandidateOpportunity[],
    strategy: GreedyRankingStrategy,
    minimizePTO = false
): GreedyCandidateOpportunity[] {
    const sorted = [...candidates];
    sorted.sort((a, b) => {
        // Always prioritize candidates that satisfy an unmet hard break requirement
        if (a.helpsUnsatisfiedRequirement !== b.helpsUnsatisfiedRequirement) {
            return a.helpsUnsatisfiedRequirement ? -1 : 1;
        }
        if (minimizePTO && a.ptoAdded !== b.ptoAdded) {
            return a.ptoAdded - b.ptoAdded;
        }

        switch (strategy) {
            case 'max_additional_days_off': {
                if (b.deltaCalendarDaysOff !== a.deltaCalendarDaysOff) {
                    return b.deltaCalendarDaysOff - a.deltaCalendarDaysOff;
                }
                if (Math.abs(b.marginalEfficiency - a.marginalEfficiency) > 1e-6) {
                    return b.marginalEfficiency - a.marginalEfficiency;
                }
                return b.deltaObjectiveScore - a.deltaObjectiveScore;
            }
            case 'max_qualifying_break_duration': {
                if (b.resultingMaxBreakDuration !== a.resultingMaxBreakDuration) {
                    return b.resultingMaxBreakDuration - a.resultingMaxBreakDuration;
                }
                if (b.deltaCalendarDaysOff !== a.deltaCalendarDaysOff) {
                    return b.deltaCalendarDaysOff - a.deltaCalendarDaysOff;
                }
                return a.ptoAdded - b.ptoAdded;
            }
            case 'max_qualifying_breaks': {
                if (b.deltaQualifyingBreaks !== a.deltaQualifyingBreaks) {
                    return b.deltaQualifyingBreaks - a.deltaQualifyingBreaks;
                }
                if (b.marginalEfficiency !== a.marginalEfficiency) {
                    return b.marginalEfficiency - a.marginalEfficiency;
                }
                return b.deltaCalendarDaysOff - a.deltaCalendarDaysOff;
            }
            case 'best_marginal_efficiency':
            default: {
                if (Math.abs(b.marginalEfficiency - a.marginalEfficiency) > 1e-6) {
                    return b.marginalEfficiency - a.marginalEfficiency;
                }
                if (b.deltaCalendarDaysOff !== a.deltaCalendarDaysOff) {
                    return b.deltaCalendarDaysOff - a.deltaCalendarDaysOff;
                }
                return b.deltaObjectiveScore - a.deltaObjectiveScore;
            }
        }
    });

    return sorted;
}
