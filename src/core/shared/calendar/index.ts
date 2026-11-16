import type {
    BreakCategoryCounts,
    BreakCategoryName,
    BreakDetail,
    BreakDurationRules,
    CalendarDay,
    DateRestrictions,
    PublicHoliday,
    SharedOptimizationRules
} from '../types/index.ts';

/**
 * Single canonical source of Singapore 2027 Public Holidays used across
 * the Calendar UI and all five optimization algorithms.
 */
export const PUBLIC_HOLIDAYS_2027: PublicHoliday[] = [
    { date: '2027-01-01', name: "New Year's Day" },
    { date: '2027-02-06', name: 'Chinese New Year (Day 1)' },
    { date: '2027-02-07', name: 'Chinese New Year (Day 2)' },
    { date: '2027-02-08', name: 'Chinese New Year Holiday off-in-lieu' },
    { date: '2027-03-10', name: 'Hari Raya Puasa' },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-05-01', name: 'Labour Day' },
    { date: '2027-05-17', name: 'Hari Raya Haji' },
    { date: '2027-05-20', name: 'Vesak Day' },
    { date: '2027-08-09', name: 'National Day' },
    { date: '2027-10-28', name: 'Deepavali' },
    { date: '2027-12-25', name: 'Christmas' }
];

export function parseDateYMD(dateStr: string): { year: number; month: number; day: number } {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
        throw new Error(`Invalid date format: ${dateStr}. Expected YYYY-MM-DD.`);
    }
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    return { year, month, day };
}

export function dateToUTCMs(dateStr: string): number {
    const { year, month, day } = parseDateYMD(dateStr);
    return Date.UTC(year, month, day);
}

export function utcMsToDateStr(utcMs: number): string {
    const d = new Date(utcMs);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function diffCalendarDays(startDate: string, endDate: string): number {
    return Math.round((dateToUTCMs(endDate) - dateToUTCMs(startDate)) / ONE_DAY_MS);
}

export function addCalendarDays(dateStr: string, offsetDays: number): string {
    return utcMsToDateStr(dateToUTCMs(dateStr) + offsetDays * ONE_DAY_MS);
}

export function isDateInProhibitedRange(dateStr: string, restrictions?: DateRestrictions): boolean {
    if (!restrictions) return false;
    for (const r of restrictions.prohibitedDateRanges) {
        if (r.startDate && r.endDate && dateStr >= r.startDate && dateStr <= r.endDate) {
            return true;
        }
    }
    return false;
}

export function isDateInRequiredRange(dateStr: string, restrictions?: DateRestrictions): boolean {
    if (!restrictions?.requiredDateRanges) return false;
    for (const r of restrictions.requiredDateRanges) {
        if (r.startDate && r.endDate && dateStr >= r.startDate && dateStr <= r.endDate) {
            return true;
        }
    }
    return false;
}

/**
 * Builds the chronological array of CalendarDay objects from startDate to endDate (inclusive).
 */
export function buildCalendarDays(
    startDate: string,
    endDate: string,
    publicHolidays: PublicHoliday[] = PUBLIC_HOLIDAYS_2027,
    restrictions?: DateRestrictions
): CalendarDay[] {
    if (!startDate || !endDate || startDate > endDate) {
        return [];
    }

    const holidayMap = new Map<string, string>();
    for (const h of publicHolidays) {
        holidayMap.set(h.date, h.name);
    }

    const blackoutSet = new Set<string>(restrictions?.blackoutDates ?? []);
    const requiredSet = new Set<string>(restrictions?.requiredPTODates ?? []);

    const startMs = dateToUTCMs(startDate);
    const endMs = dateToUTCMs(endDate);
    const totalDays = Math.round((endMs - startMs) / ONE_DAY_MS) + 1;

    const days: CalendarDay[] = [];
    let workingDayCounter = 0;

    for (let i = 0; i < totalDays; i++) {
        const currentMs = startMs + i * ONE_DAY_MS;
        const d = new Date(currentMs);
        const dateStr = utcMsToDateStr(currentMs);
        const dayOfWeek = d.getUTCDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const holidayName = holidayMap.get(dateStr);
        const isPublicHoliday = holidayName !== undefined;
        const isFixedOff = isWeekend || isPublicHoliday;
        const isEligibleWorkingDay = !isFixedOff;

        const isBlackout =
            isEligibleWorkingDay && (blackoutSet.has(dateStr) || isDateInProhibitedRange(dateStr, restrictions));
        const isRequiredPTO =
            isEligibleWorkingDay && (requiredSet.has(dateStr) || isDateInRequiredRange(dateStr, restrictions));

        days.push({
            index: i,
            date: dateStr,
            year: d.getUTCFullYear(),
            month: d.getUTCMonth(),
            dayOfMonth: d.getUTCDate(),
            dayOfWeek,
            isWeekend,
            isPublicHoliday,
            holidayName,
            isFixedOff,
            isEligibleWorkingDay,
            workingDayIndex: isEligibleWorkingDay ? workingDayCounter++ : -1,
            isBlackout,
            isRequiredPTO,
            isAdjacentToHoliday: false,
            isAdjacentToWeekend: false
        });
    }

    // Populate adjacency flags on eligible working days
    // Also check one calendar day before startDate and one calendar day after endDate for holiday/weekend adjacency
    for (let i = 0; i < days.length; i++) {
        const day = days[i];
        if (!day.isEligibleWorkingDay) continue;

        const prevDateStr = addCalendarDays(day.date, -1);
        const nextDateStr = addCalendarDays(day.date, 1);
        const prevDow = (day.dayOfWeek + 6) % 7;
        const nextDow = (day.dayOfWeek + 1) % 7;

        const prevIsHoliday = i > 0 ? days[i - 1].isPublicHoliday : holidayMap.has(prevDateStr);
        const nextIsHoliday = i < days.length - 1 ? days[i + 1].isPublicHoliday : holidayMap.has(nextDateStr);

        const prevIsWeekend = i > 0 ? days[i - 1].isWeekend : prevDow === 0 || prevDow === 6;
        const nextIsWeekend = i < days.length - 1 ? days[i + 1].isWeekend : nextDow === 0 || nextDow === 6;

        day.isAdjacentToHoliday = prevIsHoliday || nextIsHoliday;
        day.isAdjacentToWeekend = prevIsWeekend || nextIsWeekend;
    }

    return days;
}

/**
 * Classifies a break duration into enabled break categories.
 */
export function classifyBreakDuration(
    duration: number,
    breakRules: BreakDurationRules
): {
    isQualifying: boolean;
    primaryCategory: BreakCategoryName | 'Uncategorized';
    matchedCategories: BreakCategoryName[];
} {
    const orderedCategories: Array<{ name: BreakCategoryName; minDuration: number; enabled: boolean }> = [
        { name: 'short' as const, minDuration: breakRules.short.minDuration, enabled: breakRules.short.enabled },
        { name: 'medium' as const, minDuration: breakRules.medium.minDuration, enabled: breakRules.medium.enabled },
        { name: 'long' as const, minDuration: breakRules.long.minDuration, enabled: breakRules.long.enabled },
        { name: 'extended' as const, minDuration: breakRules.extended.minDuration, enabled: breakRules.extended.enabled }
    ].sort((a, b) => a.minDuration - b.minDuration);

    const anyCategoryEnabled = orderedCategories.some(c => c.enabled);

    const matched: BreakCategoryName[] = [];
    for (const cat of orderedCategories) {
        if ((anyCategoryEnabled ? cat.enabled : true) && duration >= cat.minDuration) {
            matched.push(cat.name);
        }
    }

    if (matched.length === 0) {
        return {
            isQualifying: false,
            primaryCategory: 'Uncategorized',
            matchedCategories: []
        };
    }

    const primaryCategory = matched[matched.length - 1];
    return {
        isQualifying: true,
        primaryCategory,
        matchedCategories: breakRules.allowOverlappingCategoryCounts ? matched : [primaryCategory]
    };
}

/**
 * Extracts all contiguous off-day blocks (weekends + public holidays + allocated PTO)
 * and classifies them according to BreakDurationRules.
 */
export function analyzeBreaks(
    calendarDays: CalendarDay[],
    selectedPTODates: Iterable<string>,
    breakRules: BreakDurationRules
): {
    allOffBlocks: BreakDetail[];
    activeBreaks: BreakDetail[]; // blocks that either qualify or contain PTO
    qualifyingBreaks: BreakDetail[];
    categoryCounts: BreakCategoryCounts;
    continuousBreakDates: string[];
} {
    const ptoSet = new Set<string>(selectedPTODates);
    const allOffBlocks: BreakDetail[] = [];

    let i = 0;
    while (i < calendarDays.length) {
        const d = calendarDays[i];
        const isOff = d.isFixedOff || (d.isEligibleWorkingDay && ptoSet.has(d.date));
        if (!isOff) {
            i++;
            continue;
        }

        const startIdx = i;
        const ptoDates: string[] = [];
        let weekendDays = 0;
        let publicHolidayDays = 0;

        while (i < calendarDays.length) {
            const cur = calendarDays[i];
            const curIsOff = cur.isFixedOff || (cur.isEligibleWorkingDay && ptoSet.has(cur.date));
            if (!curIsOff) break;

            if (cur.isEligibleWorkingDay && ptoSet.has(cur.date)) {
                ptoDates.push(cur.date);
            }
            if (cur.isWeekend) weekendDays++;
            if (cur.isPublicHoliday) publicHolidayDays++;
            i++;
        }

        const endIdx = i - 1;
        const duration = endIdx - startIdx + 1;
        const classification = classifyBreakDuration(duration, breakRules);

        allOffBlocks.push({
            startDate: calendarDays[startIdx].date,
            endDate: calendarDays[endIdx].date,
            startIndex: startIdx,
            endIndex: endIdx,
            duration,
            ptoDates,
            ptoUsed: ptoDates.length,
            weekendDays,
            publicHolidayDays,
            isQualifying: classification.isQualifying,
            primaryCategory: classification.primaryCategory,
            matchedCategories: classification.matchedCategories
        });
    }

    const qualifyingBreaks = allOffBlocks.filter(b => b.isQualifying);
    const activeBreaks = allOffBlocks.filter(b => b.isQualifying || b.ptoUsed > 0);

    const categoryCounts: BreakCategoryCounts = {
        short: 0,
        medium: 0,
        long: 0,
        extended: 0
    };

    for (const qb of qualifyingBreaks) {
        for (const cat of qb.matchedCategories) {
            categoryCounts[cat]++;
        }
    }

    const continuousBreakDates: string[] = [];
    for (const ab of activeBreaks) {
        for (let idx = ab.startIndex; idx <= ab.endIndex; idx++) {
            continuousBreakDates.push(calendarDays[idx].date);
        }
    }

    return {
        allOffBlocks,
        activeBreaks,
        qualifyingBreaks,
        categoryCounts,
        continuousBreakDates
    };
}

/**
 * Checks whether a single eligible working day is allowed to have PTO allocated
 * under blackout, prohibited range, and adjacency rules.
 */
export function isWorkingDayAllowedForPTO(day: CalendarDay, rules: SharedOptimizationRules): boolean {
    if (!day.isEligibleWorkingDay) return false;
    if (day.isBlackout) return false;
    if (!rules.allocation.allowPTOAdjacentToHolidays && day.isAdjacentToHoliday) return false;
    if (!rules.allocation.allowPTOAdjacentToWeekends && day.isAdjacentToWeekend) return false;
    return true;
}

/**
 * Computes the maximum streak of consecutive PTO working days in a given allocation.
 * Note: Consecutive PTO working days measures contiguous runs of PTO without an intervening
 * non-working day (weekend/PH) or worked day, OR contiguous working days taken as PTO.
 * Here we check contiguous working days taken as PTO within a single continuous break block
 * as well as strictly consecutive calendar PTO days: specifically, in any single uninterrupted
 * work week / stretch between fixed holidays/weekends, a run of consecutive PTO days.
 */
export function getMaxConsecutivePTORun(
    calendarDays: CalendarDay[],
    ptoSet: ReadonlySet<string>
): number {
    let maxRun = 0;
    let currentRun = 0;

    for (const day of calendarDays) {
        if (day.isEligibleWorkingDay) {
            if (ptoSet.has(day.date)) {
                currentRun++;
                if (currentRun > maxRun) maxRun = currentRun;
            } else {
                currentRun = 0;
            }
        }
    }

    return maxRun;
}

export interface CandidateBreakInterval {
    id: number;
    workStartIdx: number; // index a in workingDays[0..M-1]
    workEndIdx: number; // index b in workingDays[0..M-1]
    calStartIdx: number; // inclusive calendar index S(a)
    calEndIdx: number; // inclusive calendar index E(b)
    startDate: string;
    endDate: string;
    ptoDates: string[];
    ptoCost: number; // b - a + 1
    calDuration: number; // E(b) - S(a) + 1
    isQualifying: boolean;
    primaryCategory: BreakCategoryName | 'Uncategorized';
    matchedCategories: BreakCategoryName[];
    coversRequiredCount: number;
}

/**
 * Generates all valid contiguous working-day intervals [a, b] that can form a single
 * continuous PTO-enhanced break on the calendar.
 */
export function generateCandidateBreakIntervals(
    calendarDays: CalendarDay[],
    rules: SharedOptimizationRules,
    availablePTO: number
): {
    workingDays: CalendarDay[];
    intervals: CandidateBreakInterval[];
} {
    const workingDays = calendarDays.filter(d => d.isEligibleWorkingDay);
    const M = workingDays.length;
    const N = calendarDays.length;
    const intervals: CandidateBreakInterval[] = [];

    if (M === 0 || availablePTO <= 0) {
        return { workingDays, intervals };
    }

    const maxConsec = rules.allocation.maxConsecutivePTOWorkingDays ?? availablePTO;
    const maxLen = Math.min(availablePTO, maxConsec, M);

    let idCounter = 0;
    for (let a = 0; a < M; a++) {
        if (!isWorkingDayAllowedForPTO(workingDays[a], rules)) continue;

        const calStartIdx = a === 0 ? 0 : workingDays[a - 1].index + 1;
        const ptoDates: string[] = [];
        let coversRequiredCount = 0;

        for (let b = a; b < Math.min(M, a + maxLen); b++) {
            const wDay = workingDays[b];
            if (!isWorkingDayAllowedForPTO(wDay, rules)) break;

            ptoDates.push(wDay.date);
            if (wDay.isRequiredPTO) coversRequiredCount++;

            const ptoCost = b - a + 1;
            if (ptoCost > maxLen) break;

            const calEndIdx = b === M - 1 ? N - 1 : workingDays[b + 1].index - 1;
            const calDuration = calEndIdx - calStartIdx + 1;
            const classification = classifyBreakDuration(calDuration, rules.breakDuration);

            intervals.push({
                id: idCounter++,
                workStartIdx: a,
                workEndIdx: b,
                calStartIdx,
                calEndIdx,
                startDate: calendarDays[calStartIdx].date,
                endDate: calendarDays[calEndIdx].date,
                ptoDates: [...ptoDates],
                ptoCost,
                calDuration,
                isQualifying: classification.isQualifying,
                primaryCategory: classification.primaryCategory,
                matchedCategories: classification.matchedCategories,
                coversRequiredCount
            });
        }
    }

    return { workingDays, intervals };
}
