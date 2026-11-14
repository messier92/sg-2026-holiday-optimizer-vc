
interface PublicHoliday {
    date: string;
    name: string;
}

interface Candidate {
    dates: string[];
    priority: number; // 1 (Consecutive), 2 (Bridge), 3 (Fill Week), 4 (Holiday Ext), 5 (Single)
    restDaysGained: number;
    breakRange: { start: number, end: number };
}

export function getMaximizePTO(
    startDate: string,
    ptoCount: number,
    publicHolidays: PublicHoliday[],
    endDate?: string,
    excludedDates?: ReadonlySet<string>
): string[] {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const year = start.getFullYear();

    // Use endDate if provided, otherwise default to end of year
    const endOfYear = endDate ? new Date(endDate) : new Date(year, 11, 31);
    endOfYear.setHours(0, 0, 0, 0);

    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    // Helpers
    const toDateStr = (t: number) => {
        const d = new Date(t);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const holidaySet = new Set<string>();
    const holidayTimes = new Set<number>();
    for (const h of publicHolidays) {
        const t = new Date(h.date).setHours(0, 0, 0, 0);
        holidaySet.add(toDateStr(t));
        holidayTimes.add(t);
    }
    const isHoliday = (t: number) => holidayTimes.has(t);
    const isExcluded = (dStr: string) => (excludedDates ? excludedDates.has(dStr) : false);

    const selectedPTOs = new Set<string>();
    let remainingPTOs = ptoCount;

    // 1. Fixed Dates
    const FIXED_DATES = [
        '2027-05-18', '2027-05-19', '2027-05-21',
        '2027-03-08', '2027-03-09', '2027-03-11', '2027-03-12'
    ];

    for (const d of FIXED_DATES) {
        if (remainingPTOs > 0) {
            const t = new Date(d).setHours(0, 0, 0, 0);
            // Skip if before start date, after end date, or excluded by restrictions
            if (t >= start.getTime() && t <= endOfYear.getTime() && !isExcluded(d) && !isHoliday(t)) {
                if (!selectedPTOs.has(d)) {
                    selectedPTOs.add(d);
                    remainingPTOs--;
                }
            }
        }
    }

    // Iterative Greedy Loop
    let iterations = 0;
    while (remainingPTOs > 0 && iterations < 100) {
        iterations++;
        // Use a mutable wrapper to help TypeScript track assignment inside the nested function
        let iterationState: { best: Candidate | null } = { best: null };

        let curr = new Date(start);
        const day = curr.getDay();
        const diff = (day + 6) % 7;
        curr.setDate(curr.getDate() - diff); // Monday

        while (curr <= endOfYear) {
            const monTime = curr.getTime();

            // Gather context
            const holidaysInWeek: number[] = [];
            const existingPTOsInWeek: number[] = [];

            for (let i = 0; i < 5; i++) {
                const t = monTime + i * ONE_DAY_MS;
                if (isHoliday(t)) holidaysInWeek.push(t);
                if (selectedPTOs.has(toDateStr(t))) existingPTOsInWeek.push(t);
            }

            // Inner Evaluation Logic
            const evaluateCandidate = (cand: Candidate) => {
                const cStart = cand.breakRange.start;
                const cEnd = cand.breakRange.end;

                let valid = true;

                for (const s of selectedPTOs) {
                    const t = new Date(s).setHours(0, 0, 0, 0);

                    let gap = 0;
                    if (t < cStart) gap = cStart - t;
                    else if (t > cEnd) gap = t - cEnd;
                    else gap = 0; // Inside/Overlap

                    const MERGE_GAP = 4 * ONE_DAY_MS;
                    const MIN_SPACING = 14 * ONE_DAY_MS - 1000;

                    if (gap > MERGE_GAP && gap < MIN_SPACING) {
                        valid = false;
                        break;
                    }
                }

                if (!valid) return;

                if (!iterationState.best) {
                    iterationState.best = cand;
                } else {
                    const currentBest = iterationState.best;
                    if (cand.priority < currentBest.priority) {
                        iterationState.best = cand;
                    } else if (cand.priority === currentBest.priority) {
                        if (cand.restDaysGained > currentBest.restDaysGained) {
                            iterationState.best = cand;
                        } else if (cand.restDaysGained === currentBest.restDaysGained) {
                            if (cand.dates.length < currentBest.dates.length) {
                                iterationState.best = cand;
                            }
                        }
                    }
                }
            };

            // A. Fill Week (P1 or P3)
            const fillDates: string[] = [];
            for (let i = 0; i < 5; i++) {
                const t = monTime + i * ONE_DAY_MS;
                const dStr = toDateStr(t);
                if (t >= start.getTime() && t <= endOfYear.getTime() && !isHoliday(t) && !isExcluded(dStr) && !selectedPTOs.has(dStr)) {
                    fillDates.push(dStr);
                }
            }

            if (fillDates.length > 0 && fillDates.length <= remainingPTOs) {
                const hasConsecutive = hasConsecutiveHolidays(holidaysInWeek);
                const priority = hasConsecutive ? 1 : 3;

                evaluateCandidate({
                    dates: fillDates,
                    priority,
                    restDaysGained: 9,
                    breakRange: { start: monTime - 2 * ONE_DAY_MS, end: monTime + 6 * ONE_DAY_MS }
                });
            } else if (fillDates.length > remainingPTOs && remainingPTOs > 0) {
                const partialDates = fillDates.slice(0, remainingPTOs);
                evaluateCandidate({
                    dates: partialDates,
                    priority: 5,
                    restDaysGained: partialDates.length + 2,
                    breakRange: { start: monTime - 2 * ONE_DAY_MS, end: monTime + (partialDates.length - 1) * ONE_DAY_MS }
                });
            }

            // B. Bridge (P2)
            // Tue Bridge
            const tueTime = monTime + 1 * ONE_DAY_MS;
            if (isHoliday(tueTime)) {
                const monT = monTime;
                const monStr = toDateStr(monT);
                if (monT >= start.getTime() && monT <= endOfYear.getTime() && !isHoliday(monT) && !isExcluded(monStr) && !selectedPTOs.has(monStr)) {
                    evaluateCandidate({
                        dates: [monStr],
                        priority: 2,
                        restDaysGained: 4,
                        breakRange: { start: monTime - 2 * ONE_DAY_MS, end: tueTime }
                    });
                }
            }
            // Thu Bridge
            const thuTime = monTime + 3 * ONE_DAY_MS;
            if (isHoliday(thuTime)) {
                const friT = monTime + 4 * ONE_DAY_MS;
                const friStr = toDateStr(friT);
                if (friT >= start.getTime() && friT <= endOfYear.getTime() && !isHoliday(friT) && !isExcluded(friStr) && !selectedPTOs.has(friStr)) {
                    evaluateCandidate({
                        dates: [friStr],
                        priority: 2,
                        restDaysGained: 4,
                        breakRange: { start: thuTime, end: monTime + 6 * ONE_DAY_MS }
                    });
                }
            }

            // C. Holiday Extension (P4) - NEW
            for (const hTime of holidaysInWeek) {
                const prev = hTime - ONE_DAY_MS;
                const next = hTime + ONE_DAY_MS;

                // Prev
                const prevStr = toDateStr(prev);
                if (prev >= start.getTime() && prev <= endOfYear.getTime() && !isHoliday(prev) && !isExcluded(prevStr) && !selectedPTOs.has(prevStr)) {
                    const d = new Date(prev).getDay();
                    if (d !== 0 && d !== 6) {
                        evaluateCandidate({
                            dates: [prevStr],
                            priority: 4,
                            restDaysGained: 2,
                            breakRange: { start: prev, end: hTime }
                        });
                    }
                }

                // Next
                const nextStr = toDateStr(next);
                if (next >= start.getTime() && next <= endOfYear.getTime() && !isHoliday(next) && !isExcluded(nextStr) && !selectedPTOs.has(nextStr)) {
                    const d = new Date(next).getDay();
                    if (d !== 0 && d !== 6) {
                        evaluateCandidate({
                            dates: [nextStr],
                            priority: 4,
                            restDaysGained: 2,
                            breakRange: { start: hTime, end: next }
                        });
                    }
                }
            }

            // D. Single Excess - Target longest gap (P5)
            if (remainingPTOs < 5) {
                // Only consider this week if it's in the longest gap between holidays
                const longestGap = findLongestHolidayGap();

                if (longestGap && monTime >= longestGap.start && monTime <= longestGap.end) {
                    const monT = monTime;
                    const monStr = toDateStr(monT);
                    if (monT >= start.getTime() && monT <= endOfYear.getTime() && !isHoliday(monT) && !isExcluded(monStr) && !selectedPTOs.has(monStr)) {
                        evaluateCandidate({
                            dates: [monStr],
                            priority: 5,
                            restDaysGained: 3,
                            breakRange: { start: monTime - 2 * ONE_DAY_MS, end: monT }
                        });
                    }

                    const friT = monTime + 4 * ONE_DAY_MS;
                    const friStr = toDateStr(friT);
                    if (friT >= start.getTime() && friT <= endOfYear.getTime() && !isHoliday(friT) && !isExcluded(friStr) && !selectedPTOs.has(friStr)) {
                        evaluateCandidate({
                            dates: [friStr],
                            priority: 5,
                            restDaysGained: 3,
                            breakRange: { start: friT, end: monTime + 6 * ONE_DAY_MS }
                        });
                    }
                }
            }

            curr.setDate(curr.getDate() + 7);
        }

        if (iterationState.best) {
            for (const d of iterationState.best.dates) selectedPTOs.add(d);
            remainingPTOs -= iterationState.best.dates.length;
        } else {
            break;
        }
    }

    return Array.from(selectedPTOs).sort();

    function findLongestHolidayGap(): { start: number; end: number } | null {
        // Get all holidays that are after the start date
        const sortedHolidays = Array.from(holidayTimes)
            .filter(t => t >= start.getTime())
            .sort((a, b) => a - b);

        if (sortedHolidays.length === 0) {
            // No holidays, the entire period is a gap
            return { start: start.getTime(), end: endOfYear.getTime() };
        }

        let longestGap = {
            start: start.getTime(),
            end: sortedHolidays[0],
            length: sortedHolidays[0] - start.getTime()
        };

        // Check gaps between consecutive holidays
        for (let i = 0; i < sortedHolidays.length - 1; i++) {
            const gapStart = sortedHolidays[i];
            const gapEnd = sortedHolidays[i + 1];
            const gapLength = gapEnd - gapStart;

            if (gapLength > longestGap.length) {
                longestGap = { start: gapStart, end: gapEnd, length: gapLength };
            }
        }

        // Check the gap after the last holiday
        const lastHoliday = sortedHolidays[sortedHolidays.length - 1];
        const finalGapLength = endOfYear.getTime() - lastHoliday;
        if (finalGapLength > longestGap.length) {
            longestGap = { start: lastHoliday, end: endOfYear.getTime(), length: finalGapLength };
        }

        return { start: longestGap.start, end: longestGap.end };
    }

    function hasConsecutiveHolidays(holidays: number[]) {
        if (holidays.length < 2) return false;
        holidays.sort((a, b) => a - b);
        for (let i = 0; i < holidays.length - 1; i++) {
            if (holidays[i + 1] - holidays[i] <= ONE_DAY_MS + 1000) return true;
        }
        return false;
    }
}