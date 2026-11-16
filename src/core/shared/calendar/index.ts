import type {
    BreakCategoryCounts,
    BreakCategoryName,
    BreakDetail,
    BreakDurationRules,
    CalendarDay,
    DateRestrictions,
    FixedICTPeriod,
    ICTPeriod,
    ICTRules,
    PublicHoliday,
    SharedOptimizationInput,
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

export function isDateInFixedICTPeriod(dateStr: string, ictRules?: ICTRules): boolean {
    if (!ictRules?.enabled || !ictRules.fixedICTPeriods) return false;
    for (const r of ictRules.fixedICTPeriods) {
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
    restrictions?: DateRestrictions,
    ictRules?: ICTRules
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
        const isFixedICT = isDateInFixedICTPeriod(dateStr, ictRules);

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
            isFixedICT,
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
 * Extracts separate contiguous ICT periods from a set of selected ICT calendar dates.
 * ICT duration is measured in inclusive calendar days (weekends and public holidays inside
 * an ICT period count towards ICT consumption).
 */
export function extractICTPeriods(
    calendarDays: CalendarDay[],
    selectedICTDates: Iterable<string>,
    fixedICTPeriods: FixedICTPeriod[] = []
): ICTPeriod[] {
    const ictSet = new Set<string>(selectedICTDates);
    if (ictSet.size === 0 || calendarDays.length === 0) return [];

    const periods: ICTPeriod[] = [];
    let i = 0;
    let periodNumber = 1;

    while (i < calendarDays.length) {
        if (!ictSet.has(calendarDays[i].date)) {
            i++;
            continue;
        }
        const startIdx = i;
        let workingDaysCovered = 0;
        let weekendDaysCovered = 0;
        let publicHolidayDaysCovered = 0;

        while (i < calendarDays.length && ictSet.has(calendarDays[i].date)) {
            const cur = calendarDays[i];
            if (cur.isEligibleWorkingDay) workingDaysCovered++;
            if (cur.isWeekend) weekendDaysCovered++;
            if (cur.isPublicHoliday) publicHolidayDaysCovered++;
            i++;
        }

        const endIdx = i - 1;
        const startDate = calendarDays[startIdx].date;
        const endDate = calendarDays[endIdx].date;
        const duration = endIdx - startIdx + 1;

        const matchingFixed = fixedICTPeriods.find(
            f => f.startDate === startDate && f.endDate === endDate
        );

        periods.push({
            periodNumber: periodNumber++,
            startDate,
            endDate,
            startIndex: startIdx,
            endIndex: endIdx,
            duration,
            workingDaysCovered,
            weekendDaysCovered,
            publicHolidayDaysCovered,
            isFixed: !!matchingFixed,
            label: matchingFixed?.label
        });
    }

    return periods;
}

/**
 * Extracts all contiguous off-day blocks (weekends + public holidays + allocated PTO + allocated ICT)
 * and classifies them according to BreakDurationRules.
 */
export function analyzeBreaks(
    calendarDays: CalendarDay[],
    selectedPTODates: Iterable<string>,
    breakRules: BreakDurationRules,
    selectedICTDates?: Iterable<string>
): {
    allOffBlocks: BreakDetail[];
    activeBreaks: BreakDetail[]; // blocks that either qualify or contain PTO or ICT
    qualifyingBreaks: BreakDetail[];
    categoryCounts: BreakCategoryCounts;
    continuousBreakDates: string[];
} {
    const ptoSet = new Set<string>(selectedPTODates);
    const ictSet = new Set<string>(selectedICTDates ?? []);
    const allOffBlocks: BreakDetail[] = [];

    let i = 0;
    while (i < calendarDays.length) {
        const d = calendarDays[i];
        const isOff =
            d.isFixedOff ||
            ictSet.has(d.date) ||
            (d.isEligibleWorkingDay && ptoSet.has(d.date));
        if (!isOff) {
            i++;
            continue;
        }

        const startIdx = i;
        const ptoDates: string[] = [];
        const ictDates: string[] = [];
        let weekendDays = 0;
        let publicHolidayDays = 0;

        while (i < calendarDays.length) {
            const cur = calendarDays[i];
            const curIsOff =
                cur.isFixedOff ||
                ictSet.has(cur.date) ||
                (cur.isEligibleWorkingDay && ptoSet.has(cur.date));
            if (!curIsOff) break;

            if (ictSet.has(cur.date)) {
                ictDates.push(cur.date);
            } else if (cur.isEligibleWorkingDay && ptoSet.has(cur.date)) {
                ptoDates.push(cur.date);
            } else if (cur.isPublicHoliday) {
                publicHolidayDays++;
            } else if (cur.isWeekend) {
                weekendDays++;
            }
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
            ictDates,
            ictUsed: ictDates.length,
            weekendDays,
            publicHolidayDays,
            isQualifying: classification.isQualifying,
            primaryCategory: classification.primaryCategory,
            matchedCategories: classification.matchedCategories
        });
    }

    const qualifyingBreaks = allOffBlocks.filter(b => b.isQualifying);
    const activeBreaks = allOffBlocks.filter(
        b => b.isQualifying || b.ptoUsed > 0 || b.ictUsed > 0
    );

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
 * under blackout, prohibited range, ICT non-overlap, and adjacency rules.
 */
export function isWorkingDayAllowedForPTO(
    day: CalendarDay,
    rules: SharedOptimizationRules,
    ictSet?: ReadonlySet<string>
): boolean {
    if (!day.isEligibleWorkingDay) return false;
    if (day.isBlackout) return false;
    if (day.isFixedICT) return false;
    if (ictSet && ictSet.has(day.date)) return false;
    if (!rules.allocation.allowPTOAdjacentToHolidays && day.isAdjacentToHoliday) return false;
    if (!rules.allocation.allowPTOAdjacentToWeekends && day.isAdjacentToWeekend) return false;
    return true;
}

/**
 * Computes the maximum streak of consecutive PTO working days in a given allocation.
 */
export function getMaxConsecutivePTORun(
    calendarDays: CalendarDay[],
    ptoSet: ReadonlySet<string>,
    ictSet?: ReadonlySet<string>
): number {
    let maxRun = 0;
    let currentRun = 0;

    for (const day of calendarDays) {
        if (ictSet && ictSet.has(day.date)) {
            currentRun = 0;
            continue;
        }
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
 * continuous PTO-enhanced break on the calendar (accounting for any allocated ICT dates).
 */
export function generateCandidateBreakIntervals(
    calendarDays: CalendarDay[],
    rules: SharedOptimizationRules,
    availablePTO: number,
    selectedICTDates?: Iterable<string>
): {
    workingDays: CalendarDay[];
    intervals: CandidateBreakInterval[];
} {
    const ictSet = new Set<string>(selectedICTDates ?? []);
    const workingDays: CalendarDay[] = [];
    for (const d of calendarDays) {
        if (d.isEligibleWorkingDay && !ictSet.has(d.date)) {
            workingDays.push({
                ...d,
                workingDayIndex: workingDays.length
            });
        }
    }

    const M = workingDays.length;
    const N = calendarDays.length;
    const intervals: CandidateBreakInterval[] = [];

    if (M === 0 || availablePTO <= 0) {
        return { workingDays, intervals };
    }

    const maxConsec = rules.allocation.maxConsecutivePTOWorkingDays;
    const maxLen = Math.min(availablePTO, maxConsec !== null ? Math.max(maxConsec * 2, availablePTO) : availablePTO, M);

    let idCounter = 0;
    for (let a = 0; a < M; a++) {
        if (!isWorkingDayAllowedForPTO(workingDays[a], rules, ictSet)) continue;

        const calStartIdx = a === 0 ? 0 : workingDays[a - 1].index + 1;
        const ptoDates: string[] = [];
        let coversRequiredCount = 0;

        for (let b = a; b < Math.min(M, a + maxLen); b++) {
            const wDay = workingDays[b];
            if (!isWorkingDayAllowedForPTO(wDay, rules, ictSet)) break;

            ptoDates.push(wDay.date);
            if (wDay.isRequiredPTO) coversRequiredCount++;

            const ptoCost = b - a + 1;
            if (ptoCost > availablePTO) break;

            // Check maxConsecutivePTOWorkingDays across this interval (an intervening ICT period resets the consecutive PTO run)
            if (maxConsec !== null) {
                let consecRun = 1;
                let maxInIv = 1;
                for (let k = a + 1; k <= b; k++) {
                    // Check if any ICT day lies between workingDays[k-1].index and workingDays[k].index
                    let hasICFGap = false;
                    for (let cIdx = workingDays[k - 1].index + 1; cIdx < workingDays[k].index; cIdx++) {
                        if (ictSet.has(calendarDays[cIdx].date)) {
                            hasICFGap = true;
                            break;
                        }
                    }
                    if (hasICFGap) {
                        consecRun = 1;
                    } else {
                        consecRun++;
                        if (consecRun > maxInIv) maxInIv = consecRun;
                    }
                }
                if (maxInIv > maxConsec) break;
            }

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

/**
 * Generates a portfolio of valid candidate ICT calendar date allocations (each represented as a sorted string[] of YYYY-MM-DD dates)
 * satisfying all ICT quota, period duration, period count, spacing, and non-overlap constraints.
 */
export function generateCandidateICTSchedules(
    calendarDays: CalendarDay[],
    input: SharedOptimizationInput
): string[][] {
    const { rules, ptoAllowance } = input;
    const ict = rules.ict;
    if (!ict || !ict.enabled || calendarDays.length === 0) {
        return [[]];
    }

    const N = calendarDays.length;
    const availableICT = Math.max(0, ict.annualICTQuota - ict.reserveICTDays);
    const minICTRequired = ict.allowUnusedICTQuota ? ict.minICTDaysToAllocate : availableICT;

    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    const dayIndexMap = new Map<string, number>();
    for (let i = 0; i < N; i++) {
        dayIndexMap.set(calendarDays[i].date, i);
    }

    // Collect fixed ICT intervals
    const fixedIntervals: Array<{ s: number; e: number }> = [];
    const fixedDateSet = new Set<string>();
    for (const fp of ict.fixedICTPeriods) {
        const s = dayIndexMap.get(fp.startDate);
        const e = dayIndexMap.get(fp.endDate);
        if (s !== undefined && e !== undefined && s <= e) {
            fixedIntervals.push({ s, e });
            for (let idx = s; idx <= e; idx++) {
                fixedDateSet.add(calendarDays[idx].date);
            }
        }
    }
    fixedIntervals.sort((a, b) => a.s - b.s);
    const fixedDaysCount = fixedDateSet.size;
    const fixedPeriodCount = fixedIntervals.length;

    const effectiveMaxPeriods = !ict.allowMultipleICTPeriods
        ? 1
        : ict.maxNumberOfICTPeriods !== null
          ? ict.maxNumberOfICTPeriods
          : Math.min(12, Math.max(4, Math.ceil(Math.max(1, availableICT) / Math.max(1, ict.minPeriodDuration))));

    // Determine whether we only need the fixed ICT periods
    const fixedSatisfiesMin =
        fixedDaysCount >= minICTRequired &&
        fixedPeriodCount >= ict.minNumberOfICTPeriods;

    if (
        availableICT === 0 ||
        fixedDaysCount >= availableICT ||
        fixedPeriodCount >= effectiveMaxPeriods ||
        (fixedPeriodCount > 0 &&
            ict.allowUnusedICTQuota &&
            fixedSatisfiesMin &&
            rules.objectives.primary !== 'maximize_ict_utilization')
    ) {
        return [Array.from(fixedDateSet).sort()];
    }

    // Determine which calendar days can be used for automatic ICT allocation
    const canUseCalDay = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
        const d = calendarDays[i];
        const isProhibited =
            blackoutSet.has(d.date) || isDateInProhibitedRange(d.date, rules.restrictions);
        if (!isProhibited && !d.isRequiredPTO && !fixedDateSet.has(d.date)) {
            canUseCalDay[i] = 1;
        }
    }

    // Enforce spacing buffer around fixed ICT periods
    const minSpacing = Math.max(1, ict.minCalendarDaysBetweenICTPeriods);
    for (const fp of fixedIntervals) {
        const lo = Math.max(0, fp.s - minSpacing);
        const hi = Math.min(N - 1, fp.e + minSpacing);
        for (let i = lo; i <= hi; i++) {
            canUseCalDay[i] = 0;
        }
    }

    // How many additional allowed working days can ICT cover without starving required PTO budget?
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const minPTORequired = rules.allocation.allowUnusedPTO
        ? rules.allocation.minPTOToAllocate
        : availablePTO;
    let remainingAllowedWorkingDays = 0;
    for (let i = 0; i < N; i++) {
        if (!fixedDateSet.has(calendarDays[i].date) && isWorkingDayAllowedForPTO(calendarDays[i], rules)) {
            remainingAllowedWorkingDays++;
        }
    }
    const maxAdditionalWorkingDaysForICT = Math.max(0, remainingAllowedWorkingDays - minPTORequired);

    // Prefix sum of canUseCalDay so we can check in O(1) if [s, s + L - 1] is 100% valid
    const validPrefix = new Int32Array(N + 1);
    const workDayPrefix = new Int32Array(N + 1);
    for (let i = 0; i < N; i++) {
        validPrefix[i + 1] = validPrefix[i] + canUseCalDay[i];
        const isAllowedW =
            !fixedDateSet.has(calendarDays[i].date) && isWorkingDayAllowedForPTO(calendarDays[i], rules) ? 1 : 0;
        workDayPrefix[i + 1] = workDayPrefix[i] + isAllowedW;
    }

    const isIntervalAllowed = (s: number, len: number): boolean => {
        if (s < 0 || s + len > N) return false;
        return validPrefix[s + len] - validPrefix[s] === len;
    };

    const getWorkDaysInInterval = (s: number, len: number): number => {
        return workDayPrefix[s + len] - workDayPrefix[s];
    };

    // Places a sequence of period lengths [L_0, L_1, ..., L_{k-1}] on [0..N-1]
    const placePeriodLengths = (
        lengths: number[],
        mode: 'bridge_max' | 'evenly_distributed' | 'compact_earliest'
    ): string[] | null => {
        const k = lengths.length;
        if (k === 0) return Array.from(fixedDateSet).sort();

        // Precompute suffix earliest end index to guarantee exact feasibility pruning:
        // minStartForSuffix[j] = latest start index for period j such that periods j..k-1 can still fit in [0..N-1]
        const latestValidStart = new Int32Array(k);
        latestValidStart.fill(-1);

        let nextLatestStart = N;
        for (let j = k - 1; j >= 0; j--) {
            const len = lengths[j];
            const maxS = j === k - 1 ? N - len : nextLatestStart - minSpacing - len;
            let foundS = -1;
            for (let s = maxS; s >= 0; s--) {
                if (isIntervalAllowed(s, len)) {
                    foundS = s;
                    break;
                }
            }
            if (foundS < 0) return null; // Impossible to fit these lengths
            latestValidStart[j] = foundS;
            nextLatestStart = foundS;
        }

        const chosenStarts: number[] = [];
        let curMinStart = 0;
        let usedWorkDays = 0;

        for (let j = 0; j < k; j++) {
            const len = lengths[j];
            const maxS = latestValidStart[j];
            if (curMinStart > maxS) return null;

            let bestS = -1;
            let bestScore = -1e15;
            const targetCenter = ((j + 0.5) * N) / k;

            for (let s = curMinStart; s <= maxS; s++) {
                if (!isIntervalAllowed(s, len)) continue;

                const wDays = getWorkDaysInInterval(s, len);
                // Minimum working days remaining periods j+1..k-1 might cover (estimate 0 if weekend-heavy, or check budget)
                const fitsWorkBudget = usedWorkDays + wDays <= maxAdditionalWorkingDaysForICT;

                if (mode === 'compact_earliest') {
                    if (fitsWorkBudget) {
                        bestS = s;
                        break;
                    }
                    if (bestS === -1) bestS = s;
                    continue;
                }

                let score = fitsWorkBudget ? 0 : -100000 - (usedWorkDays + wDays - maxAdditionalWorkingDaysForICT) * 1000;

                // Bonus for starting right after a fixed off day (e.g. Monday or day after Public Holiday)
                if (s > 0 && calendarDays[s - 1].isFixedOff) score += 25;
                if (s > 0 && calendarDays[s - 1].isPublicHoliday) score += 20;

                // Bonus for ending right before a fixed off day (e.g. Friday before Weekend or day before Public Holiday)
                const e = s + len - 1;
                if (e + 1 < N && calendarDays[e + 1].isFixedOff) score += 25;
                if (e + 1 < N && calendarDays[e + 1].isPublicHoliday) score += 20;

                // Bonus for leaving a 1-2 working day bridge to a holiday/weekend when PTO is available
                if (availablePTO > 0) {
                    if (s >= 2 && calendarDays[s - 1].isEligibleWorkingDay && calendarDays[s - 2].isFixedOff) {
                        score += 18;
                    }
                    if (e + 2 < N && calendarDays[e + 1].isEligibleWorkingDay && calendarDays[e + 2].isFixedOff) {
                        score += 18;
                    }
                }

                if (mode === 'bridge_max') {
                    score += wDays * 8;
                    // Slight preference for spreading periods out rather than clumping
                    score -= Math.abs(s + len / 2 - targetCenter) * 0.08;
                } else if (mode === 'evenly_distributed') {
                    score -= Math.abs(s + len / 2 - targetCenter) * 2.5;
                    score += wDays * 2;
                }

                if (score > bestScore) {
                    bestScore = score;
                    bestS = s;
                }
            }

            if (bestS < 0) return null;
            chosenStarts.push(bestS);
            usedWorkDays += getWorkDaysInInterval(bestS, len);
            curMinStart = bestS + len + minSpacing;
        }

        if (usedWorkDays > maxAdditionalWorkingDaysForICT) {
            return null;
        }

        const outSet = new Set<string>(fixedDateSet);
        for (let j = 0; j < k; j++) {
            const s = chosenStarts[j];
            const len = lengths[j];
            for (let idx = s; idx < s + len; idx++) {
                outSet.add(calendarDays[idx].date);
            }
        }
        return Array.from(outSet).sort();
    };

    const minL = Math.max(1, ict.minPeriodDuration);
    const maxL =
        ict.maxPeriodDuration !== null
            ? Math.min(ict.maxPeriodDuration, availableICT, N)
            : Math.min(availableICT, N);

    const minTotalPeriods = Math.max(
        fixedPeriodCount,
        ict.minNumberOfICTPeriods,
        availableICT > 0 ? 1 : 0
    );
    const maxTotalPeriods = Math.max(minTotalPeriods, effectiveMaxPeriods);

    // Choose candidate total period counts K
    const candidateKs = new Set<number>();
    candidateKs.add(minTotalPeriods);
    if (maxTotalPeriods >= minTotalPeriods) {
        candidateKs.add(Math.min(maxTotalPeriods, minTotalPeriods + 1));
        candidateKs.add(Math.min(maxTotalPeriods, 2));
        candidateKs.add(Math.min(maxTotalPeriods, 3));
        if (ict.maxNumberOfICTPeriods !== null) {
            candidateKs.add(maxTotalPeriods);
        }
    }

    const schedules: string[][] = [];
    const seenKeys = new Set<string>();

    const addScheduleIfNew = (sched: string[] | null) => {
        if (!sched) return;
        const key = sched.join(',');
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            schedules.push(sched);
        }
    };

    for (const totalK of candidateKs) {
        if (totalK < minTotalPeriods || totalK > maxTotalPeriods) continue;
        const kAdd = totalK - fixedPeriodCount;
        if (kAdd <= 0) {
            if (fixedDaysCount >= minICTRequired) {
                addScheduleIfNew(Array.from(fixedDateSet).sort());
            }
            continue;
        }

        const minAddDays = Math.max(kAdd * minL, minICTRequired - fixedDaysCount);
        const maxAddDays = Math.min(kAdd * maxL, availableICT - fixedDaysCount);
        if (minAddDays > maxAddDays || minAddDays <= 0) continue;

        // Candidate total additional ICT days to partition across kAdd periods
        const targetTotals = new Set<number>([maxAddDays]);
        if (ict.allowUnusedICTQuota && minAddDays < maxAddDays) {
            targetTotals.add(minAddDays);
        }

        for (const totalAdd of targetTotals) {
            // 1. Balanced partition of totalAdd into kAdd lengths in [minL, maxL]
            const base = Math.floor(totalAdd / kAdd);
            const rem = totalAdd % kAdd;
            const balanced: number[] = [];
            for (let j = 0; j < kAdd; j++) {
                balanced.push(base + (j < rem ? 1 : 0));
            }
            if (balanced.every(l => l >= minL && l <= maxL)) {
                addScheduleIfNew(placePeriodLengths(balanced, 'bridge_max'));
                addScheduleIfNew(placePeriodLengths(balanced, 'evenly_distributed'));
                addScheduleIfNew(placePeriodLengths(balanced, 'compact_earliest'));
            }

            // 2. Standard 14-day block partition (e.g. 14 + 14 + 12 = 40) when valid
            if (kAdd >= 2 && minL <= 12 && maxL >= 14 && totalAdd === 40 && kAdd === 3) {
                const block14 = [14, 14, 12];
                addScheduleIfNew(placePeriodLengths(block14, 'bridge_max'));
                addScheduleIfNew(placePeriodLengths(block14, 'evenly_distributed'));
            }
        }
    }

    if (schedules.length === 0 && fixedSatisfiesMin) {
        schedules.push(Array.from(fixedDateSet).sort());
    }

    return schedules;
}
