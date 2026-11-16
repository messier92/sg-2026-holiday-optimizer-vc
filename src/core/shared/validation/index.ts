import {
    analyzeBreaks,
    buildCalendarDays,
    getMaxConsecutivePTORun,
    isDateInProhibitedRange
} from '../calendar/index.ts';
import { computeBreakSpacings } from '../constraints/index.ts';
import type {
    CalendarDay,
    ConstraintValidationResult,
    ConstraintViolation,
    SharedOptimizationInput
} from '../types/index.ts';

/**
 * Validates a PTO allocation against all hard constraints and soft preferences,
 * returning structured diagnostics for the UI and test suite.
 */
export function validateAllocation(
    selectedPTODates: string[],
    input: SharedOptimizationInput,
    calendarDays?: CalendarDay[]
): ConstraintValidationResult {
    const { startDate, endDate, ptoAllowance, publicHolidays, rules } = input;
    const days = calendarDays ?? buildCalendarDays(startDate, endDate, publicHolidays, rules.restrictions);
    const ptoSet = new Set(selectedPTODates);

    const hardConstraints: ConstraintViolation[] = [];
    const softPreferences: ConstraintViolation[] = [];

    const dayMap = new Map<string, CalendarDay>();
    for (const d of days) dayMap.set(d.date, d);

    // 1. Date range validity
    const outOfRangeDates = selectedPTODates.filter(d => d < startDate || d > endDate || !dayMap.has(d));
    hardConstraints.push({
        code: 'DATE_RANGE_BOUNDS',
        severity: 'hard',
        satisfied: startDate <= endDate && days.length > 0 && outOfRangeDates.length === 0,
        message:
            outOfRangeDates.length === 0 && startDate <= endDate && days.length > 0
                ? `All ${selectedPTODates.length} PTO dates fall within [${startDate}, ${endDate}].`
                : `Invalid date range or PTO dates out of range: ${outOfRangeDates.join(', ') || `${startDate}..${endDate}`}.`
    });

    // 2. Weekend exclusion
    const weekendPTODates = selectedPTODates.filter(d => dayMap.get(d)?.isWeekend);
    hardConstraints.push({
        code: 'NO_WEEKEND_PTO',
        severity: 'hard',
        satisfied: weekendPTODates.length === 0,
        message:
            weekendPTODates.length === 0
                ? 'No PTO allocated on weekends.'
                : `PTO allocated on weekend date(s): ${weekendPTODates.join(', ')}.`
    });

    // 3. Public Holiday exclusion
    const holidayPTODates = selectedPTODates.filter(d => dayMap.get(d)?.isPublicHoliday);
    hardConstraints.push({
        code: 'NO_PUBLIC_HOLIDAY_PTO',
        severity: 'hard',
        satisfied: holidayPTODates.length === 0,
        message:
            holidayPTODates.length === 0
                ? 'No PTO allocated on Singapore public holidays.'
                : `PTO allocated on public holiday(s): ${holidayPTODates.join(', ')}.`
    });

    // 4. Restriction conflicts (Required vs Blackout/Prohibited/Non-working)
    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    const conflictingRequired: string[] = [];
    const allRequiredWorkingDates = new Set<string>();

    for (const req of rules.restrictions.requiredPTODates) {
        const d = dayMap.get(req);
        if (blackoutSet.has(req) || isDateInProhibitedRange(req, rules.restrictions)) {
            conflictingRequired.push(`${req} (conflicts with blackout/prohibited)`);
        } else if (!d) {
            conflictingRequired.push(`${req} (outside date range)`);
        } else if (!d.isEligibleWorkingDay) {
            conflictingRequired.push(`${req} (non-working day)`);
        } else {
            allRequiredWorkingDates.add(req);
        }
    }

    for (const reqRange of rules.restrictions.requiredDateRanges ?? []) {
        if (!reqRange.startDate || !reqRange.endDate || reqRange.startDate > reqRange.endDate) {
            conflictingRequired.push(`${reqRange.startDate}..${reqRange.endDate} (invalid range)`);
            continue;
        }
        if (reqRange.startDate < startDate || reqRange.endDate > endDate) {
            conflictingRequired.push(`${reqRange.startDate}..${reqRange.endDate} (outside date range)`);
            continue;
        }
        let eligibleInRange = 0;
        for (const d of days) {
            if (d.date < reqRange.startDate || d.date > reqRange.endDate) continue;
            if (blackoutSet.has(d.date) || isDateInProhibitedRange(d.date, rules.restrictions)) {
                conflictingRequired.push(`${d.date} (conflicts with prohibited range)`);
            }
            if (d.isEligibleWorkingDay) {
                eligibleInRange++;
                allRequiredWorkingDates.add(d.date);
            }
        }
        if (eligibleInRange === 0) {
            conflictingRequired.push(`${reqRange.startDate}..${reqRange.endDate} (no eligible working days)`);
        }
    }

    hardConstraints.push({
        code: 'NO_RESTRICTION_CONFLICTS',
        severity: 'hard',
        satisfied: conflictingRequired.length === 0,
        message:
            conflictingRequired.length === 0
                ? 'No conflicts between required PTO ranges/dates and prohibited/non-working dates.'
                : `Conflicting date restrictions: ${conflictingRequired.join('; ')}.`
    });

    // 5. Blackout and prohibited ranges respected
    const blackoutViolations = selectedPTODates.filter(
        d => blackoutSet.has(d) || isDateInProhibitedRange(d, rules.restrictions)
    );
    hardConstraints.push({
        code: 'BLACKOUT_AND_PROHIBITED_DATES',
        severity: 'hard',
        satisfied: blackoutViolations.length === 0,
        message:
            blackoutViolations.length === 0
                ? 'All prohibited date ranges respected.'
                : `PTO allocated on prohibited date(s): ${blackoutViolations.join(', ')}.`
    });

    // 6. Required PTO dates satisfied
    const missingRequired = Array.from(allRequiredWorkingDates).filter(req => !ptoSet.has(req));
    hardConstraints.push({
        code: 'REQUIRED_PTO_DATES',
        severity: 'hard',
        satisfied: missingRequired.length === 0 && conflictingRequired.length === 0,
        message:
            missingRequired.length === 0 && conflictingRequired.length === 0
                ? `All required PTO working dates (${allRequiredWorkingDates.size}) allocated.`
                : `Missing required PTO date(s): ${missingRequired.join(', ') || conflictingRequired.join(', ')}.`
    });

    // 7. PTO Allowance & Reserved PTO
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const budgetSatisfied =
        rules.allocation.reservePTODays <= ptoAllowance && ptoSet.size <= availablePTO;
    hardConstraints.push({
        code: 'PTO_ALLOWANCE_LIMIT',
        severity: 'hard',
        satisfied: budgetSatisfied,
        message: budgetSatisfied
            ? `PTO consumed (${ptoSet.size}) is within available allowance (${availablePTO} days; ${rules.allocation.reservePTODays} reserved).`
            : `PTO consumed (${ptoSet.size}) exceeds available allowance (${availablePTO}) or reserved PTO (${rules.allocation.reservePTODays}) exceeds total (${ptoAllowance}).`
    });

    // 8. Minimum PTO & Unused PTO policy
    const minPTOSatisfied = ptoSet.size >= rules.allocation.minPTOToAllocate;
    const unusedPTOSatisfied = rules.allocation.allowUnusedPTO || ptoSet.size === availablePTO;
    hardConstraints.push({
        code: 'MIN_AND_UNUSED_PTO_POLICY',
        severity: 'hard',
        satisfied: minPTOSatisfied && unusedPTOSatisfied,
        message:
            minPTOSatisfied && unusedPTOSatisfied
                ? `Minimum PTO (${rules.allocation.minPTOToAllocate}) and unused PTO policy satisfied.`
                : !minPTOSatisfied
                  ? `PTO consumed (${ptoSet.size}) is below minimum required (${rules.allocation.minPTOToAllocate}).`
                  : `Unused PTO is disabled, but ${availablePTO - ptoSet.size} available PTO day(s) remain unallocated.`
    });

    // 9. Maximum consecutive PTO working days
    const maxConsecRun = getMaxConsecutivePTORun(days, ptoSet);
    const maxConsecLimit = rules.allocation.maxConsecutivePTOWorkingDays;
    const maxConsecSatisfied = maxConsecLimit === null || maxConsecRun <= maxConsecLimit;
    hardConstraints.push({
        code: 'MAX_CONSECUTIVE_PTO',
        severity: 'hard',
        satisfied: maxConsecSatisfied,
        message:
            maxConsecLimit === null
                ? `Max consecutive PTO working days is unlimited (observed max: ${maxConsecRun}).`
                : maxConsecSatisfied
                  ? `Max consecutive PTO working days (${maxConsecRun}) <= limit (${maxConsecLimit}).`
                  : `Max consecutive PTO working days (${maxConsecRun}) exceeds limit (${maxConsecLimit}).`
    });

    // 10. Holiday and Weekend adjacency rules
    const adjHolidayViolations = !rules.allocation.allowPTOAdjacentToHolidays
        ? selectedPTODates.filter(d => dayMap.get(d)?.isAdjacentToHoliday)
        : [];
    const adjWeekendViolations = !rules.allocation.allowPTOAdjacentToWeekends
        ? selectedPTODates.filter(d => dayMap.get(d)?.isAdjacentToWeekend)
        : [];
    hardConstraints.push({
        code: 'ADJACENCY_RESTRICTIONS',
        severity: 'hard',
        satisfied: adjHolidayViolations.length === 0 && adjWeekendViolations.length === 0,
        message:
            adjHolidayViolations.length === 0 && adjWeekendViolations.length === 0
                ? 'Holiday and weekend PTO adjacency rules satisfied.'
                : `Adjacency violation on date(s): ${[...adjHolidayViolations, ...adjWeekendViolations].join(', ')}.`
    });

    // 11. Break Spacing Rules
    const { activeBreaks, qualifyingBreaks, categoryCounts } = analyzeBreaks(
        days,
        ptoSet,
        rules.breakDuration
    );
    const spacings = computeBreakSpacings(activeBreaks, days);
    const workSpacingViolations = spacings.filter(
        s => s.involvesPTO && s.workingDaysBetween < rules.distribution.minWorkingDaysBetweenBreaks
    );
    const calSpacingLimit = rules.distribution.minCalendarDaysBetweenBreaks;
    const calSpacingViolations =
        calSpacingLimit !== null && calSpacingLimit > 0
            ? spacings.filter(s => s.involvesPTO && s.calendarDaysBetween < calSpacingLimit)
            : [];

    hardConstraints.push({
        code: 'BREAK_SPACING',
        severity: 'hard',
        satisfied: workSpacingViolations.length === 0 && calSpacingViolations.length === 0,
        message:
            workSpacingViolations.length === 0 && calSpacingViolations.length === 0
                ? `Break spacing satisfied (min ${rules.distribution.minWorkingDaysBetweenBreaks} working days${
                      calSpacingLimit ? `, min ${calSpacingLimit} calendar days` : ''
                  } from break end to next break start).`
                : `Break spacing violated between ${[...workSpacingViolations, ...calSpacingViolations]
                      .map(
                          v =>
                              `${v.fromBreak.endDate} and ${v.toBreak.startDate} (${v.workingDaysBetween} working / ${v.calendarDaysBetween} calendar days)`
                      )
                      .join('; ')}.`
    });

    // 12. Total Qualifying Break Counts
    const minBreaks = rules.distribution.minNumberOfBreaks;
    const maxBreaks = rules.distribution.maxNumberOfBreaks;
    const breakCountSatisfied =
        qualifyingBreaks.length >= minBreaks &&
        (maxBreaks === null || qualifyingBreaks.length <= maxBreaks);
    hardConstraints.push({
        code: 'QUALIFYING_BREAK_COUNT',
        severity: 'hard',
        satisfied: breakCountSatisfied,
        message: breakCountSatisfied
            ? `Qualifying break count (${qualifyingBreaks.length}) satisfies bounds [min: ${minBreaks}, max: ${
                  maxBreaks ?? 'Unlimited'
              }].`
            : `Qualifying break count (${qualifyingBreaks.length}) violates bounds [min: ${minBreaks}, max: ${
                  maxBreaks ?? 'Unlimited'
              }].`
    });

    // 13. Break Category Count Bounds
    const categoryViolations: string[] = [];
    for (const catKey of ['short', 'medium', 'long', 'extended'] as const) {
        const rule = rules.breakDuration[catKey];
        if (!rule.enabled) continue;
        const count = categoryCounts[catKey];
        if (count < rule.minCount) {
            categoryViolations.push(`${catKey} (${count} < min ${rule.minCount})`);
        }
        if (rule.maxCount !== null && count > rule.maxCount) {
            categoryViolations.push(`${catKey} (${count} > max ${rule.maxCount})`);
        }
    }
    hardConstraints.push({
        code: 'BREAK_CATEGORY_COUNTS',
        severity: 'hard',
        satisfied: categoryViolations.length === 0,
        message:
            categoryViolations.length === 0
                ? `All enabled break category count bounds satisfied (S:${categoryCounts.short}, M:${categoryCounts.medium}, L:${categoryCounts.long}, E:${categoryCounts.extended}).`
                : `Break category count violation(s): ${categoryViolations.join(', ')}.`
    });

    // Soft Preferences
    if (
        rules.distribution.evenlyDistributeBreaks ||
        rules.objectives.secondaries.prefer_evenly_distributed_breaks.enabled
    ) {
        const hasMultipleOrSingleWellPlaced = activeBreaks.length >= 2 || days.length < 30;
        softPreferences.push({
            code: 'SOFT_EVEN_DISTRIBUTION',
            severity: 'soft',
            satisfied: hasMultipleOrSingleWellPlaced,
            message: `Even break distribution preference evaluated across ${activeBreaks.length} break(s).`
        });
    }

    if (rules.objectives.secondaries.prefer_longer_breaks.enabled) {
        const maxDur = activeBreaks.reduce((m, b) => Math.max(m, b.duration), 0);
        softPreferences.push({
            code: 'SOFT_LONGER_BREAKS',
            severity: 'soft',
            satisfied: maxDur >= 4 || selectedPTODates.length === 0,
            message: `Prefer longer breaks (longest continuous break: ${maxDur} days).`
        });
    }

    if (rules.objectives.secondaries.prefer_more_frequent_breaks.enabled) {
        softPreferences.push({
            code: 'SOFT_FREQUENT_BREAKS',
            severity: 'soft',
            satisfied: qualifyingBreaks.length >= 1 || selectedPTODates.length === 0,
            message: `Prefer more frequent breaks (${qualifyingBreaks.length} qualifying breaks).`
        });
    }

    if (rules.objectives.secondaries.minimize_consecutive_pto.enabled) {
        softPreferences.push({
            code: 'SOFT_MIN_CONSECUTIVE_PTO',
            severity: 'soft',
            satisfied: maxConsecRun <= 3,
            message: `Minimize consecutive PTO working days (max consecutive PTO used: ${maxConsecRun}).`
        });
    }

    if (rules.objectives.secondaries.minimize_unused_pto.enabled) {
        const unused = Math.max(0, availablePTO - ptoSet.size);
        softPreferences.push({
            code: 'SOFT_MIN_UNUSED_PTO',
            severity: 'soft',
            satisfied: unused === 0,
            message: `Minimize unused PTO (${unused} unused day(s) out of ${availablePTO}).`
        });
    }

    const isValid = hardConstraints.every(c => c.satisfied);

    return {
        isValid,
        hardConstraints,
        softPreferences
    };
}
