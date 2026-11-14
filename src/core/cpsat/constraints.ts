import {
    buildCalendarDays,
    generateCandidateBreakIntervals
} from '../shared/calendar/index.ts';
import { areIntervalsCompatible } from '../shared/constraints/index.ts';
import type { SharedOptimizationInput } from '../shared/types/index.ts';
import type { BoolDomain, CPSATIntervalVar, CPSATModel } from './types.ts';

/**
 * Builds the CP-SAT Boolean & Interval constraint model, including incompatibility graphs
 * for NoOverlapWithSpacing propagation and domain filtering.
 */
export function buildCPSATModel(input: SharedOptimizationInput): CPSATModel {
    const { startDate, endDate, ptoAllowance, publicHolidays, rules } = input;
    const calendarDays = buildCalendarDays(startDate, endDate, publicHolidays, rules.restrictions);
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const minPTORequired = rules.allocation.allowUnusedPTO
        ? rules.allocation.minPTOToAllocate
        : availablePTO;

    const { workingDays, intervals } = generateCandidateBreakIntervals(
        calendarDays,
        rules,
        availablePTO
    );

    const M = workingDays.length;
    const requiredWorkIndices = workingDays
        .filter(w => w.isRequiredPTO)
        .map(w => w.workingDayIndex);

    const intervalVars: CPSATIntervalVar[] = intervals.map(iv => ({
        id: iv.id,
        interval: iv,
        domain: 2 as BoolDomain,
        incompatibleIds: [],
        objectiveWeight: 0
    }));

    // Build NoOverlap + Spacing incompatibility lists
    for (let i = 0; i < intervalVars.length; i++) {
        const ivA = intervalVars[i].interval;
        for (let j = i + 1; j < intervalVars.length; j++) {
            const ivB = intervalVars[j].interval;
            const compatible =
                ivA.workEndIdx < ivB.workStartIdx
                    ? areIntervalsCompatible(ivA, ivB, rules)
                    : ivB.workEndIdx < ivA.workStartIdx
                      ? areIntervalsCompatible(ivB, ivA, rules)
                      : false;
            if (!compatible) {
                intervalVars[i].incompatibleIds.push(j);
                intervalVars[j].incompatibleIds.push(i);
            }
        }
    }

    // Initial domain propagation for required PTO working days
    const minWorkSpacing = Math.max(1, rules.distribution.minWorkingDaysBetweenBreaks);
    for (const v of intervalVars) {
        for (const rIdx of requiredWorkIndices) {
            if (rIdx >= v.interval.workStartIdx && rIdx <= v.interval.workEndIdx) {
                continue;
            }
            const dist =
                rIdx < v.interval.workStartIdx
                    ? v.interval.workStartIdx - rIdx - 1
                    : rIdx - v.interval.workEndIdx - 1;
            if (dist < minWorkSpacing) {
                v.domain = 0; // Propagate False: violates mandatory PTO spacing
                break;
            }
        }
    }

    const intervalsByWorkStart: number[][] = Array.from({ length: M }, () => []);
    const intervalsCoveringWorkDay: number[][] = Array.from({ length: M }, () => []);

    for (const v of intervalVars) {
        if (v.domain === 0) continue;
        intervalsByWorkStart[v.interval.workStartIdx].push(v.id);
        for (let w = v.interval.workStartIdx; w <= v.interval.workEndIdx; w++) {
            intervalsCoveringWorkDay[w].push(v.id);
        }
    }

    return {
        calendarDays,
        workingDays,
        intervalVars,
        intervalsByWorkStart,
        intervalsCoveringWorkDay,
        availablePTO,
        minPTORequired,
        requiredWorkIndices
    };
}
