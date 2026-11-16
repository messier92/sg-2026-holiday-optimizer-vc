import {
    classifyBreakDuration,
    isWorkingDayAllowedForPTO
} from '../shared/calendar/index.ts';
import type { CalendarDay, SharedOptimizationInput } from '../shared/types/index.ts';
import type { DPStateNode } from './types.ts';

/**
 * Computes incremental objective gain when closing a contiguous off-day block
 * of `curOffDays` calendar days that used `curBreakPTO` PTO days.
 */
export function evaluateClosedBreakGain(
    curOffDays: number,
    curBreakPTO: number,
    input: SharedOptimizationInput,
    curBreakICT = 0
): {
    objectiveDelta: number;
    isQualifying: boolean;
    shortAdd: number;
    mediumAdd: number;
    longAdd: number;
    extendedAdd: number;
    activeBreakDaysAdd: number;
} {
    if (curOffDays <= 0) {
        return {
            objectiveDelta: 0,
            isQualifying: false,
            shortAdd: 0,
            mediumAdd: 0,
            longAdd: 0,
            extendedAdd: 0,
            activeBreakDaysAdd: 0
        };
    }

    const { rules } = input;
    const classification = classifyBreakDuration(curOffDays, rules.breakDuration);
    const isActiveBreak = classification.isQualifying || curBreakPTO > 0 || curBreakICT > 0;

    let shortAdd = 0;
    let mediumAdd = 0;
    let longAdd = 0;
    let extendedAdd = 0;

    if (classification.isQualifying) {
        for (const cat of classification.matchedCategories) {
            if (cat === 'short') shortAdd++;
            if (cat === 'medium') mediumAdd++;
            if (cat === 'long') longAdd++;
            if (cat === 'extended') extendedAdd++;
        }
    }

    const activeBreakDaysAdd = isActiveBreak ? curOffDays : 0;

    let primaryPart = 0;
    switch (rules.objectives.primary) {
        case 'maximize_total_days_off':
            primaryPart = activeBreakDaysAdd;
            break;
        case 'maximize_qualifying_breaks':
            primaryPart = classification.isQualifying ? 1 : 0;
            break;
        case 'maximize_extended_breaks':
            primaryPart = extendedAdd;
            break;
        case 'maximize_pto_efficiency':
            primaryPart = curBreakPTO > 0 ? activeBreakDaysAdd / curBreakPTO : 0;
            break;
        case 'maximize_ict_utilization':
        case 'combine_ict_with_pto_and_holidays':
            primaryPart = activeBreakDaysAdd + (curBreakICT > 0 && curBreakPTO > 0 ? 4 : 0);
            break;
        case 'maximize_break_distribution':
            primaryPart = classification.isQualifying ? 10 + activeBreakDaysAdd * 0.2 : activeBreakDaysAdd * 0.1;
            break;
        case 'minimize_pto_consumption':
            primaryPart = -curBreakPTO;
            break;
    }

    const sec = rules.objectives.secondaries;
    let secondaryPart = 0;
    if (isActiveBreak) {
        if (sec.prefer_longer_breaks.enabled) {
            secondaryPart += sec.prefer_longer_breaks.weight * (curOffDays * curOffDays * 0.1);
        }
        if (sec.prefer_more_frequent_breaks.enabled) {
            secondaryPart +=
                sec.prefer_more_frequent_breaks.weight * (classification.isQualifying ? 7 : 2);
        }
        if (sec.minimize_consecutive_pto.enabled) {
            secondaryPart -= sec.minimize_consecutive_pto.weight * (curBreakPTO * 3);
        }
        if (sec.minimize_unused_pto.enabled) {
            secondaryPart += sec.minimize_unused_pto.weight * (curBreakPTO * 4);
        }
        if (sec.maximize_total_days_off.enabled) {
            secondaryPart += sec.maximize_total_days_off.weight * (activeBreakDaysAdd * 2);
        }
        secondaryPart += activeBreakDaysAdd * 0.01 + (classification.isQualifying ? 0.005 : 0);
    }

    return {
        objectiveDelta: primaryPart * 100000 + secondaryPart,
        isQualifying: classification.isQualifying,
        shortAdd,
        mediumAdd,
        longAdd,
        extendedAdd,
        activeBreakDaysAdd
    };
}

/**
 * Generates valid next-day DP states from `state` when transitioning across `day`.
 */
export function expandDPStateTransitions(
    state: DPStateNode,
    day: CalendarDay,
    input: SharedOptimizationInput,
    ictScheduleSet?: ReadonlySet<string>
): DPStateNode[] {
    const { rules } = input;
    const minWorkSpacing = rules.distribution.minWorkingDaysBetweenBreaks;
    const minCalSpacing = rules.distribution.minCalendarDaysBetweenBreaks ?? 0;
    const maxConsecPTO = rules.allocation.maxConsecutivePTOWorkingDays;

    const nextStates: DPStateNode[] = [];

    // Case 0: Allocated ICT Day (from ICT schedule)
    // Consumes 1 ICT calendar day, never consumes PTO, and extends the current continuous break!
    if (ictScheduleSet && ictScheduleSet.has(day.date)) {
        const nextCalCooldown = Math.max(0, state.calCooldown - 1);
        const isStartingNewICTPeriod = state.curICTDuration === 0;
        nextStates.push({
            dayIndex: day.index + 1,
            remPTO: state.remPTO,
            remICT: Math.max(0, state.remICT - 1),
            curOffDays: state.curOffDays + 1,
            curBreakPTO: state.curBreakPTO,
            curBreakICT: state.curBreakICT + 1,
            curICTDuration: state.curICTDuration + 1,
            ictPeriodsUsed: isStartingNewICTPeriod
                ? state.ictPeriodsUsed + 1
                : state.ictPeriodsUsed,
            curConsecPTO: 0,
            workCooldown: state.workCooldown,
            calCooldown: nextCalCooldown,
            qualifyingBreaks: state.qualifyingBreaks,
            shortCount: state.shortCount,
            mediumCount: state.mediumCount,
            longCount: state.longCount,
            extendedCount: state.extendedCount,
            accObjective: state.accObjective,
            totalBreakDaysOff: state.totalBreakDaysOff,
            parent: state,
            tookPTOOnPrevDay: false,
            tookICTOnPrevDay: true
        });
        return nextStates;
    }

    // Case 1: Fixed non-working day (Weekend or Singapore Public Holiday)
    // Never consumes PTO; automatically extends the current off-day streak.
    if (day.isFixedOff) {
        const nextCalCooldown = Math.max(0, state.calCooldown - 1);
        nextStates.push({
            dayIndex: day.index + 1,
            remPTO: state.remPTO,
            remICT: state.remICT,
            curOffDays: state.curOffDays + 1,
            curBreakPTO: state.curBreakPTO,
            curBreakICT: state.curBreakICT,
            curICTDuration: 0,
            ictPeriodsUsed: state.ictPeriodsUsed,
            curConsecPTO: state.curConsecPTO,
            workCooldown: state.workCooldown,
            calCooldown: nextCalCooldown,
            qualifyingBreaks: state.qualifyingBreaks,
            shortCount: state.shortCount,
            mediumCount: state.mediumCount,
            longCount: state.longCount,
            extendedCount: state.extendedCount,
            accObjective: state.accObjective,
            totalBreakDaysOff: state.totalBreakDaysOff,
            parent: state,
            tookPTOOnPrevDay: false,
            tookICTOnPrevDay: false
        });
        return nextStates;
    }

    // Day is an eligible working day: two possible decisions (0 = Work, 1 = Allocate PTO)

    // Decision A: Work today (do NOT allocate PTO) — allowed unless today is a required PTO date
    if (!day.isRequiredPTO) {
        // Working today closes any ongoing off-day streak!
        const gain = evaluateClosedBreakGain(
            state.curOffDays,
            state.curBreakPTO,
            input,
            state.curBreakICT
        );

        const nextQualifying = state.qualifyingBreaks + (gain.isQualifying ? 1 : 0);
        const nextShort = state.shortCount + gain.shortAdd;
        const nextMedium = state.mediumCount + gain.mediumAdd;
        const nextLong = state.longCount + gain.longAdd;
        const nextExtended = state.extendedCount + gain.extendedAdd;

        // Check upper bounds on break counts if any
        const maxBreaksOk =
            rules.distribution.maxNumberOfBreaks === null ||
            nextQualifying <= rules.distribution.maxNumberOfBreaks;
        const catMaxOk =
            (!rules.breakDuration.short.enabled ||
                rules.breakDuration.short.maxCount === null ||
                nextShort <= rules.breakDuration.short.maxCount) &&
            (!rules.breakDuration.medium.enabled ||
                rules.breakDuration.medium.maxCount === null ||
                nextMedium <= rules.breakDuration.medium.maxCount) &&
            (!rules.breakDuration.long.enabled ||
                rules.breakDuration.long.maxCount === null ||
                nextLong <= rules.breakDuration.long.maxCount) &&
            (!rules.breakDuration.extended.enabled ||
                rules.breakDuration.extended.maxCount === null ||
                nextExtended <= rules.breakDuration.extended.maxCount);

        if (maxBreaksOk && catMaxOk) {
            // If we just closed a break that used PTO, start the spacing cooldown (minus 1 because today is worked!)
            let nextWorkCooldown = Math.max(0, state.workCooldown - 1);
            let nextCalCooldown = Math.max(0, state.calCooldown - 1);

            if (state.curBreakPTO > 0) {
                nextWorkCooldown = Math.max(0, minWorkSpacing - 1);
                nextCalCooldown = Math.max(0, minCalSpacing - 1);
            }

            nextStates.push({
                dayIndex: day.index + 1,
                remPTO: state.remPTO,
                remICT: state.remICT,
                curOffDays: 0,
                curBreakPTO: 0,
                curBreakICT: 0,
                curICTDuration: 0,
                ictPeriodsUsed: state.ictPeriodsUsed,
                curConsecPTO: 0,
                workCooldown: nextWorkCooldown,
                calCooldown: nextCalCooldown,
                qualifyingBreaks: nextQualifying,
                shortCount: nextShort,
                mediumCount: nextMedium,
                longCount: nextLong,
                extendedCount: nextExtended,
                accObjective: state.accObjective + gain.objectiveDelta,
                totalBreakDaysOff: state.totalBreakDaysOff + gain.activeBreakDaysAdd,
                parent: state,
                tookPTOOnPrevDay: false,
                tookICTOnPrevDay: false
            });
        }
    }

    // Decision B: Allocate 1 PTO day today
    if (state.remPTO > 0 && isWorkingDayAllowedForPTO(day, rules, ictScheduleSet)) {
        const nextConsecPTO = state.curConsecPTO + 1;
        const consecOk = maxConsecPTO === null || nextConsecPTO <= maxConsecPTO;

        // If starting a new PTO break (state.curBreakPTO === 0), we must have 0 cooldown from the previous PTO break!
        const spacingOk =
            state.curBreakPTO > 0 || (state.workCooldown === 0 && state.calCooldown === 0);

        if (consecOk && spacingOk) {
            nextStates.push({
                dayIndex: day.index + 1,
                remPTO: state.remPTO - 1,
                remICT: state.remICT,
                curOffDays: state.curOffDays + 1,
                curBreakPTO: state.curBreakPTO + 1,
                curBreakICT: state.curBreakICT,
                curICTDuration: 0,
                ictPeriodsUsed: state.ictPeriodsUsed,
                curConsecPTO: nextConsecPTO,
                workCooldown: 0,
                calCooldown: 0,
                qualifyingBreaks: state.qualifyingBreaks,
                shortCount: state.shortCount,
                mediumCount: state.mediumCount,
                longCount: state.longCount,
                extendedCount: state.extendedCount,
                accObjective: state.accObjective,
                totalBreakDaysOff: state.totalBreakDaysOff,
                parent: state,
                tookPTOOnPrevDay: true,
                tookICTOnPrevDay: false
            });
        }
    }

    return nextStates;
}
