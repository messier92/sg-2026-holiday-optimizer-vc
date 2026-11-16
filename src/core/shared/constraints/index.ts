import {
    analyzeBreaks,
    buildCalendarDays,
    getMaxConsecutivePTORun,
    isDateInProhibitedRange,
    isWorkingDayAllowedForPTO,
    type CandidateBreakInterval
} from '../calendar/index.ts';
import type {
    BreakDetail,
    CalendarDay,
    SharedOptimizationInput,
    SharedOptimizationRules
} from '../types/index.ts';

export interface FeasibilityCheck {
    feasible: boolean;
    reasons: string[];
    availablePTO: number;
    requiredEligibleDates: string[];
}

/**
 * Performs a fast up-front check for structural infeasibility before running a solver.
 */
export function checkUpfrontFeasibility(
    input: SharedOptimizationInput,
    calendarDays?: CalendarDay[]
): FeasibilityCheck {
    const reasons: string[] = [];
    const { startDate, endDate, ptoAllowance, publicHolidays, rules } = input;
    const days = calendarDays ?? buildCalendarDays(startDate, endDate, publicHolidays, rules.restrictions);

    if (!startDate || !endDate || startDate > endDate || days.length === 0) {
        reasons.push('Selected date range is invalid or empty.');
    }

    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    if (rules.allocation.reservePTODays > ptoAllowance) {
        reasons.push(
            `Reserved PTO days (${rules.allocation.reservePTODays}) exceed total PTO allowance (${ptoAllowance}).`
        );
    }

    if (rules.allocation.minPTOToAllocate > availablePTO) {
        reasons.push(
            `Minimum PTO to allocate (${rules.allocation.minPTOToAllocate}) exceeds available PTO (${availablePTO}).`
        );
    }

    // Check conflicts between requiredPTODates and blackoutDates / prohibitedDateRanges
    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    const dayByDate = new Map<string, CalendarDay>();
    for (const d of days) dayByDate.set(d.date, d);

    const requiredEligibleSet = new Set<string>();
    for (const reqDate of rules.restrictions.requiredPTODates) {
        if (blackoutSet.has(reqDate) || isDateInProhibitedRange(reqDate, rules.restrictions)) {
            reasons.push(`Conflicting restriction: ${reqDate} is marked as both Required PTO and Blackout/Prohibited.`);
        }
        const calDay = dayByDate.get(reqDate);
        if (!calDay) {
            reasons.push(`Required PTO date ${reqDate} is outside the selected date range (${startDate} to ${endDate}).`);
        } else if (!calDay.isEligibleWorkingDay) {
            reasons.push(`Required PTO date ${reqDate} falls on a weekend or public holiday and cannot consume PTO.`);
        } else if (!isWorkingDayAllowedForPTO(calDay, rules)) {
            reasons.push(`Required PTO date ${reqDate} violates adjacency or blackout restrictions.`);
        } else {
            requiredEligibleSet.add(reqDate);
        }
    }

    for (const reqRange of rules.restrictions.requiredDateRanges ?? []) {
        if (!reqRange.startDate || !reqRange.endDate || reqRange.startDate > reqRange.endDate) {
            reasons.push('Invalid Required PTO date range.');
            continue;
        }
        if (reqRange.startDate < startDate || reqRange.endDate > endDate) {
            reasons.push(
                `Required PTO range [${reqRange.startDate} to ${reqRange.endDate}] is outside the selected date range (${startDate} to ${endDate}).`
            );
            continue;
        }
        let eligibleInRange = 0;
        for (const d of days) {
            if (d.date < reqRange.startDate || d.date > reqRange.endDate) continue;
            if (blackoutSet.has(d.date) || isDateInProhibitedRange(d.date, rules.restrictions)) {
                reasons.push(
                    `Conflicting restriction: ${d.date} is marked as both Required PTO and Prohibited.`
                );
            }
            if (d.isEligibleWorkingDay) {
                eligibleInRange++;
                if (!isWorkingDayAllowedForPTO(d, rules)) {
                    reasons.push(
                        `Required PTO date ${d.date} violates adjacency or prohibited restrictions.`
                    );
                } else {
                    requiredEligibleSet.add(d.date);
                }
            }
        }
        if (eligibleInRange === 0) {
            reasons.push(
                `Required PTO range [${reqRange.startDate} to ${reqRange.endDate}] contains no eligible working days.`
            );
        }
    }

    const requiredEligibleDates = Array.from(requiredEligibleSet).sort();

    if (requiredEligibleDates.length > availablePTO) {
        reasons.push(
            `Required PTO dates (${requiredEligibleDates.length}) exceed available PTO allowance (${availablePTO}).`
        );
    }

    const allowedWorkingDays = days.filter(d => isWorkingDayAllowedForPTO(d, rules));

    if (rules.allocation.minPTOToAllocate > allowedWorkingDays.length) {
        reasons.push(
            `Minimum PTO to allocate (${rules.allocation.minPTOToAllocate}) exceeds eligible non-blackout working days (${allowedWorkingDays.length}).`
        );
    }

    if (!rules.allocation.allowUnusedPTO && availablePTO > allowedWorkingDays.length) {
        reasons.push(
            `Allow unused PTO is disabled, but available PTO (${availablePTO}) exceeds eligible working days (${allowedWorkingDays.length}).`
        );
    }

    if (
        rules.allocation.maxConsecutivePTOWorkingDays !== null &&
        rules.allocation.maxConsecutivePTOWorkingDays <= 0 &&
        (requiredEligibleDates.length > 0 || rules.allocation.minPTOToAllocate > 0 || (!rules.allocation.allowUnusedPTO && availablePTO > 0))
    ) {
        reasons.push('Maximum consecutive PTO working days is set to 0 while positive PTO allocation is required.');
    }

    if (
        rules.distribution.maxNumberOfBreaks !== null &&
        rules.distribution.minNumberOfBreaks > rules.distribution.maxNumberOfBreaks
    ) {
        reasons.push(
            `Minimum number of breaks (${rules.distribution.minNumberOfBreaks}) exceeds maximum number of breaks (${rules.distribution.maxNumberOfBreaks}).`
        );
    }

    for (const catKey of ['short', 'medium', 'long', 'extended'] as const) {
        const cat = rules.breakDuration[catKey];
        if (cat.enabled && cat.maxCount !== null && cat.minCount > cat.maxCount) {
            reasons.push(
                `Category "${catKey}" minimum break count (${cat.minCount}) exceeds its maximum count (${cat.maxCount}).`
            );
        }
    }

    return {
        feasible: reasons.length === 0,
        reasons,
        availablePTO,
        requiredEligibleDates
    };
}

/**
 * Checks whether two candidate break intervals [a1, b1] and [a2, b2] (with b1 < a2)
 * satisfy the break spacing rules.
 * Spacing is measured strictly from the end of Break 1 to the start of Break 2.
 */
export function areIntervalsCompatible(
    first: CandidateBreakInterval,
    second: CandidateBreakInterval,
    rules: SharedOptimizationRules
): boolean {
    if (first.workEndIdx >= second.workStartIdx) {
        return false;
    }

    // Must have at least 1 non-PTO working day between two distinct working-day intervals
    // otherwise they would merge into a single continuous break!
    const workingDaysBetween = second.workStartIdx - first.workEndIdx - 1;
    if (workingDaysBetween < 1) {
        return false;
    }

    const minWorkSpacing = Math.max(1, rules.distribution.minWorkingDaysBetweenBreaks);
    if (workingDaysBetween < minWorkSpacing) {
        return false;
    }

    if (
        rules.distribution.minCalendarDaysBetweenBreaks !== null &&
        rules.distribution.minCalendarDaysBetweenBreaks > 0
    ) {
        const calendarDaysBetween = second.calStartIdx - first.calEndIdx - 1;
        if (calendarDaysBetween < rules.distribution.minCalendarDaysBetweenBreaks) {
            return false;
        }
    }

    return true;
}

/**
 * Computes spacing between consecutive breaks in a given list of breaks.
 * Spacing is measured from the end of break i to the beginning of break i+1.
 */
export function computeBreakSpacings(
    breaks: BreakDetail[],
    calendarDays: CalendarDay[]
): Array<{
    fromBreak: BreakDetail;
    toBreak: BreakDetail;
    workingDaysBetween: number;
    calendarDaysBetween: number;
    involvesPTO: boolean;
}> {
    const spacings: Array<{
        fromBreak: BreakDetail;
        toBreak: BreakDetail;
        workingDaysBetween: number;
        calendarDaysBetween: number;
        involvesPTO: boolean;
    }> = [];

    for (let i = 0; i < breaks.length - 1; i++) {
        const b1 = breaks[i];
        const b2 = breaks[i + 1];
        const calendarDaysBetween = b2.startIndex - b1.endIndex - 1;
        let workingDaysBetween = 0;
        for (let idx = b1.endIndex + 1; idx < b2.startIndex; idx++) {
            if (calendarDays[idx].isEligibleWorkingDay) {
                workingDaysBetween++;
            }
        }
        spacings.push({
            fromBreak: b1,
            toBreak: b2,
            workingDaysBetween,
            calendarDaysBetween,
            involvesPTO: b1.ptoUsed > 0 || b2.ptoUsed > 0
        });
    }

    return spacings;
}

/**
 * Checks whether a candidate set of PTO dates satisfies all local and global hard constraints.
 */
export function isAllocationHardValid(
    calendarDays: CalendarDay[],
    ptoDates: Iterable<string>,
    input: SharedOptimizationInput
): boolean {
    const ptoSet = new Set(ptoDates);
    const { rules, ptoAllowance } = input;
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);

    if (rules.allocation.reservePTODays > ptoAllowance) return false;
    if (ptoSet.size > availablePTO) return false;
    if (ptoSet.size < rules.allocation.minPTOToAllocate) return false;
    if (!rules.allocation.allowUnusedPTO && ptoSet.size !== availablePTO) return false;

    const dayMap = new Map<string, CalendarDay>();
    for (const d of calendarDays) dayMap.set(d.date, d);

    // Every allocated PTO date must be an allowed eligible working day in range
    for (const dStr of ptoSet) {
        const day = dayMap.get(dStr);
        if (!day || !isWorkingDayAllowedForPTO(day, rules)) {
            return false;
        }
    }

    // Required PTO dates and ranges
    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    for (const reqStr of rules.restrictions.requiredPTODates) {
        if (blackoutSet.has(reqStr) || isDateInProhibitedRange(reqStr, rules.restrictions)) {
            return false;
        }
        const day = dayMap.get(reqStr);
        if (!day || !day.isEligibleWorkingDay) {
            return false;
        }
        if (!ptoSet.has(reqStr)) {
            return false;
        }
    }

    for (const reqRange of rules.restrictions.requiredDateRanges ?? []) {
        if (
            !reqRange.startDate ||
            !reqRange.endDate ||
            reqRange.startDate > reqRange.endDate ||
            reqRange.startDate < input.startDate ||
            reqRange.endDate > input.endDate
        ) {
            return false;
        }
        let eligibleInRange = 0;
        for (const d of calendarDays) {
            if (d.date < reqRange.startDate || d.date > reqRange.endDate) continue;
            if (blackoutSet.has(d.date) || isDateInProhibitedRange(d.date, rules.restrictions)) {
                return false;
            }
            if (d.isEligibleWorkingDay) {
                eligibleInRange++;
                if (!ptoSet.has(d.date)) {
                    return false;
                }
            }
        }
        if (eligibleInRange === 0) {
            return false;
        }
    }

    // Max consecutive PTO working days
    if (rules.allocation.maxConsecutivePTOWorkingDays !== null) {
        const maxRun = getMaxConsecutivePTORun(calendarDays, ptoSet);
        if (maxRun > rules.allocation.maxConsecutivePTOWorkingDays) {
            return false;
        }
    }

    // Analyze breaks for spacing and counts
    const { activeBreaks, qualifyingBreaks, categoryCounts } = analyzeBreaks(
        calendarDays,
        ptoSet,
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

    if (qualifyingBreaks.length < rules.distribution.minNumberOfBreaks) {
        return false;
    }
    if (
        rules.distribution.maxNumberOfBreaks !== null &&
        qualifyingBreaks.length > rules.distribution.maxNumberOfBreaks
    ) {
        return false;
    }

    for (const catKey of ['short', 'medium', 'long', 'extended'] as const) {
        const rule = rules.breakDuration[catKey];
        if (!rule.enabled) continue;
        const count = categoryCounts[catKey];
        if (count < rule.minCount) return false;
        if (rule.maxCount !== null && count > rule.maxCount) return false;
    }

    return true;
}
