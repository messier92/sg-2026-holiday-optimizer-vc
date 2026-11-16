import {
    analyzeBreaks,
    buildCalendarDays,
    diffCalendarDays,
    extractICTPeriods,
    generateCandidateICTSchedules,
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
    availableICT: number;
    fixedICTDates: string[];
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
    const days =
        calendarDays ??
        buildCalendarDays(startDate, endDate, publicHolidays, rules.restrictions, rules.ict);

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

    // ICT Feasibility Checks
    const ict = rules.ict;
    let availableICT = 0;
    const fixedICTDateSet = new Set<string>();

    if (ict?.enabled) {
        availableICT = Math.max(0, ict.annualICTQuota - ict.reserveICTDays);
        if (ict.reserveICTDays > ict.annualICTQuota) {
            reasons.push(
                `Reserved ICT days (${ict.reserveICTDays}) exceed annual ICT quota (${ict.annualICTQuota}).`
            );
        }
        if (ict.minICTDaysToAllocate > availableICT) {
            reasons.push(
                `Minimum ICT days to allocate (${ict.minICTDaysToAllocate}) exceeds available ICT quota (${availableICT}).`
            );
        }
        const minICTReq = ict.allowUnusedICTQuota ? ict.minICTDaysToAllocate : availableICT;
        if (minICTReq > days.length) {
            reasons.push(
                `Required ICT calendar days (${minICTReq}) exceed total calendar days in date range (${days.length}).`
            );
        }
        if (
            ict.maxPeriodDuration !== null &&
            ict.minPeriodDuration > ict.maxPeriodDuration
        ) {
            reasons.push(
                `Minimum ICT period duration (${ict.minPeriodDuration}) exceeds maximum ICT period duration (${ict.maxPeriodDuration}).`
            );
        }

        const effMaxPeriods = !ict.allowMultipleICTPeriods
            ? 1
            : ict.maxNumberOfICTPeriods;
        if (effMaxPeriods !== null && ict.minNumberOfICTPeriods > effMaxPeriods) {
            reasons.push(
                `Minimum number of ICT periods (${ict.minNumberOfICTPeriods}) exceeds maximum allowed ICT periods (${effMaxPeriods}).`
            );
        }
        if (
            effMaxPeriods !== null &&
            ict.maxPeriodDuration !== null &&
            effMaxPeriods * ict.maxPeriodDuration < minICTReq
        ) {
            reasons.push(
                `Maximum possible ICT days (${effMaxPeriods} period(s) × ${ict.maxPeriodDuration}d = ${
                    effMaxPeriods * ict.maxPeriodDuration
                }d) is less than required ICT allocation (${minICTReq}d).`
            );
        }

        // Validate fixed ICT periods
        const sortedFixed = [...ict.fixedICTPeriods].sort((a, b) =>
            a.startDate.localeCompare(b.startDate)
        );
        if (effMaxPeriods !== null && sortedFixed.length > effMaxPeriods) {
            reasons.push(
                `Fixed ICT periods (${sortedFixed.length}) exceed maximum allowed ICT periods (${effMaxPeriods}).`
            );
        }

        for (let i = 0; i < sortedFixed.length; i++) {
            const fp = sortedFixed[i];
            if (!fp.startDate || !fp.endDate || fp.startDate > fp.endDate) {
                reasons.push('Invalid Fixed ICT period date range.');
                continue;
            }
            if (fp.startDate < startDate || fp.endDate > endDate) {
                reasons.push(
                    `Fixed ICT period [${fp.startDate} to ${fp.endDate}] is outside the selected date range (${startDate} to ${endDate}).`
                );
                continue;
            }
            const fpLen = diffCalendarDays(fp.startDate, fp.endDate) + 1;
            if (fpLen < Math.max(1, ict.minPeriodDuration)) {
                reasons.push(
                    `Fixed ICT period [${fp.startDate} to ${fp.endDate}] duration (${fpLen}d) is shorter than minimum ICT period duration (${ict.minPeriodDuration}d).`
                );
            }
            if (ict.maxPeriodDuration !== null && fpLen > ict.maxPeriodDuration) {
                reasons.push(
                    `Fixed ICT period [${fp.startDate} to ${fp.endDate}] duration (${fpLen}d) exceeds maximum ICT period duration (${ict.maxPeriodDuration}d).`
                );
            }

            if (i > 0) {
                const prev = sortedFixed[i - 1];
                if (fp.startDate <= prev.endDate) {
                    reasons.push(
                        `Fixed ICT periods [${prev.startDate} to ${prev.endDate}] and [${fp.startDate} to ${fp.endDate}] overlap.`
                    );
                } else {
                    const calGap = diffCalendarDays(prev.endDate, fp.startDate) - 1;
                    if (calGap < Math.max(1, ict.minCalendarDaysBetweenICTPeriods)) {
                        reasons.push(
                            `Fixed ICT periods [${prev.startDate} to ${prev.endDate}] and [${fp.startDate} to ${fp.endDate}] violate minimum ICT period spacing (${calGap} < ${ict.minCalendarDaysBetweenICTPeriods} calendar days).`
                        );
                    }
                }
            }

            for (const d of days) {
                if (d.date < fp.startDate || d.date > fp.endDate) continue;
                fixedICTDateSet.add(d.date);
                if (blackoutSet.has(d.date) || isDateInProhibitedRange(d.date, rules.restrictions)) {
                    reasons.push(
                        `Conflicting restriction: ${d.date} is in both a Fixed ICT period and a Prohibited date range.`
                    );
                }
                if (requiredEligibleSet.has(d.date) || rules.restrictions.requiredPTODates.includes(d.date)) {
                    reasons.push(
                        `Conflicting restriction: ${d.date} is marked as both Fixed ICT and Required PTO.`
                    );
                }
            }
        }

        if (fixedICTDateSet.size > availableICT) {
            reasons.push(
                `Fixed ICT periods consume ${fixedICTDateSet.size} calendar days, exceeding available ICT quota (${availableICT}).`
            );
        }

        const remainingWorkingForPTO = allowedWorkingDays.filter(
            d => !fixedICTDateSet.has(d.date)
        );
        const minPTOReq = rules.allocation.allowUnusedPTO
            ? rules.allocation.minPTOToAllocate
            : availablePTO;
        if (minPTOReq > remainingWorkingForPTO.length) {
            reasons.push(
                `Required PTO allocation (${minPTOReq}d) exceeds eligible working days remaining after ICT (${remainingWorkingForPTO.length}d).`
            );
        }

        if (reasons.length === 0) {
            const candidateSchedules = generateCandidateICTSchedules(days, input);
            if (candidateSchedules.length === 0) {
                reasons.push(
                    'Infeasible ICT configuration: cannot satisfy ICT quota, period duration, period count, and spacing constraints within the selected date range.'
                );
            }
        }
    }

    return {
        feasible: reasons.length === 0,
        reasons,
        availablePTO,
        requiredEligibleDates,
        availableICT,
        fixedICTDates: Array.from(fixedICTDateSet).sort()
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
            involvesPTO: b1.ptoUsed > 0 && b2.ptoUsed > 0
        });
    }

    return spacings;
}

/**
 * Checks whether a candidate set of PTO dates (and optional ICT dates) satisfies all local and global hard constraints.
 */
export function isAllocationHardValid(
    calendarDays: CalendarDay[],
    ptoDates: Iterable<string>,
    input: SharedOptimizationInput,
    ictDates?: Iterable<string>
): boolean {
    const ptoSet = new Set(ptoDates);
    const ictSet = new Set(ictDates ?? []);
    const { rules, ptoAllowance } = input;
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);

    if (rules.allocation.reservePTODays > ptoAllowance) return false;
    if (ptoSet.size > availablePTO) return false;
    if (ptoSet.size < rules.allocation.minPTOToAllocate) return false;
    if (!rules.allocation.allowUnusedPTO && ptoSet.size !== availablePTO) return false;

    const dayMap = new Map<string, CalendarDay>();
    for (const d of calendarDays) dayMap.set(d.date, d);

    // Every allocated PTO date must be an allowed eligible working day in range and not overlap ICT
    for (const dStr of ptoSet) {
        if (ictSet.has(dStr)) return false;
        const day = dayMap.get(dStr);
        if (!day || !isWorkingDayAllowedForPTO(day, rules, ictSet)) {
            return false;
        }
    }

    // Required PTO dates and ranges
    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    for (const reqStr of rules.restrictions.requiredPTODates) {
        if (
            blackoutSet.has(reqStr) ||
            isDateInProhibitedRange(reqStr, rules.restrictions) ||
            ictSet.has(reqStr)
        ) {
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
            if (
                blackoutSet.has(d.date) ||
                isDateInProhibitedRange(d.date, rules.restrictions) ||
                ictSet.has(d.date)
            ) {
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

    // Validate ICT constraints when ICT is enabled (or if any ICT dates are provided)
    const ict = rules.ict;
    if (ict?.enabled) {
        if (ict.reserveICTDays > ict.annualICTQuota) return false;
        const availableICT = Math.max(0, ict.annualICTQuota - ict.reserveICTDays);
        if (ictSet.size > availableICT) return false;
        if (ictSet.size < ict.minICTDaysToAllocate) return false;
        if (!ict.allowUnusedICTQuota && ictSet.size !== availableICT) return false;

        for (const ictDateStr of ictSet) {
            const d = dayMap.get(ictDateStr);
            if (!d) return false;
            if (blackoutSet.has(ictDateStr) || isDateInProhibitedRange(ictDateStr, rules.restrictions)) {
                return false;
            }
            if (d.isRequiredPTO || ptoSet.has(ictDateStr)) {
                return false;
            }
        }

        // Fixed ICT periods must be respected and valid
        const sortedFixed = [...ict.fixedICTPeriods].sort((a, b) =>
            a.startDate.localeCompare(b.startDate)
        );
        for (let i = 0; i < sortedFixed.length; i++) {
            const fp = sortedFixed[i];
            if (
                !fp.startDate ||
                !fp.endDate ||
                fp.startDate > fp.endDate ||
                fp.startDate < input.startDate ||
                fp.endDate > input.endDate
            ) {
                return false;
            }
            if (i > 0 && fp.startDate <= sortedFixed[i - 1].endDate) {
                return false;
            }
            for (const d of calendarDays) {
                if (d.date >= fp.startDate && d.date <= fp.endDate) {
                    if (!ictSet.has(d.date)) return false;
                }
            }
        }

        const ictPeriods = extractICTPeriods(calendarDays, ictSet, ict.fixedICTPeriods);
        if (ictPeriods.length < ict.minNumberOfICTPeriods) return false;
        if (!ict.allowMultipleICTPeriods && ictPeriods.length > 1) return false;
        if (
            ict.maxNumberOfICTPeriods !== null &&
            ictPeriods.length > ict.maxNumberOfICTPeriods
        ) {
            return false;
        }

        const minPeriodLen = Math.max(1, ict.minPeriodDuration);
        for (const p of ictPeriods) {
            if (p.duration < minPeriodLen) return false;
            if (ict.maxPeriodDuration !== null && p.duration > ict.maxPeriodDuration) {
                return false;
            }
        }

        const minICTSpacing = Math.max(1, ict.minCalendarDaysBetweenICTPeriods);
        for (let i = 0; i < ictPeriods.length - 1; i++) {
            const calBetween = ictPeriods[i + 1].startIndex - ictPeriods[i].endIndex - 1;
            if (calBetween < minICTSpacing) return false;
        }
    } else if (ictSet.size > 0) {
        return false;
    }

    // Max consecutive PTO working days
    if (rules.allocation.maxConsecutivePTOWorkingDays !== null) {
        const maxRun = getMaxConsecutivePTORun(calendarDays, ptoSet, ictSet);
        if (maxRun > rules.allocation.maxConsecutivePTOWorkingDays) {
            return false;
        }
    }

    // Analyze breaks for spacing and counts
    const { activeBreaks, qualifyingBreaks, categoryCounts } = analyzeBreaks(
        calendarDays,
        ptoSet,
        rules.breakDuration,
        ictSet
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
