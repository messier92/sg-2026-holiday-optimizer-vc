
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
    publicHolidays: PublicHoliday[]
): string[] {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const year = start.getFullYear();
    const endOfYear = new Date(year, 11, 31);
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

    const selectedPTOs = new Set<string>();
    let remainingPTOs = ptoCount;

    // 1. Fixed Dates
    const FIXED_DATES = [
        '2026-02-16', '2026-02-19', '2026-02-20',
        '2026-05-25', '2026-05-26', '2026-05-28', '2026-05-29'
    ];

    for (const d of FIXED_DATES) {
        if (remainingPTOs > 0) {
            const t = new Date(d).setHours(0, 0, 0, 0);
            if (t >= start.getTime()) {
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
                if (t >= start.getTime() && !isHoliday(t) && !selectedPTOs.has(toDateStr(t))) {
                    fillDates.push(toDateStr(t));
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
            }

            // B. Bridge (P2)
            // Tue Bridge
            const tueTime = monTime + 1 * ONE_DAY_MS;
            if (isHoliday(tueTime)) {
                const monT = monTime;
                if (monT >= start.getTime() && !isHoliday(monT) && !selectedPTOs.has(toDateStr(monT))) {
                    evaluateCandidate({
                        dates: [toDateStr(monT)],
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
                if (friT >= start.getTime() && !isHoliday(friT) && !selectedPTOs.has(toDateStr(friT))) {
                    evaluateCandidate({
                        dates: [toDateStr(friT)],
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
                if (prev >= start.getTime() && !isHoliday(prev) && !selectedPTOs.has(toDateStr(prev))) {
                    const d = new Date(prev).getDay();
                    if (d !== 0 && d !== 6) {
                        evaluateCandidate({
                            dates: [toDateStr(prev)],
                            priority: 4,
                            restDaysGained: 2,
                            breakRange: { start: prev, end: hTime }
                        });
                    }
                }

                // Next
                if (next >= start.getTime() && !isHoliday(next) && !selectedPTOs.has(toDateStr(next))) {
                    const d = new Date(next).getDay();
                    if (d !== 0 && d !== 6) {
                        evaluateCandidate({
                            dates: [toDateStr(next)],
                            priority: 4,
                            restDaysGained: 2,
                            breakRange: { start: hTime, end: next }
                        });
                    }
                }
            }

            // D. Random Single Excess (P5)
            if (remainingPTOs < 5) {
                const monT = monTime;
                if (monT >= start.getTime() && !isHoliday(monT) && !selectedPTOs.has(toDateStr(monT))) {
                    evaluateCandidate({
                        dates: [toDateStr(monT)],
                        priority: 5,
                        restDaysGained: 3,
                        breakRange: { start: monTime - 2 * ONE_DAY_MS, end: monT }
                    });
                }

                const friT = monTime + 4 * ONE_DAY_MS;
                if (friT >= start.getTime() && !isHoliday(friT) && !selectedPTOs.has(toDateStr(friT))) {
                    evaluateCandidate({
                        dates: [toDateStr(friT)],
                        priority: 5,
                        restDaysGained: 3,
                        breakRange: { start: friT, end: monTime + 6 * ONE_DAY_MS }
                    });
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

    function hasConsecutiveHolidays(holidays: number[]) {
        if (holidays.length < 2) return false;
        holidays.sort((a, b) => a - b);
        for (let i = 0; i < holidays.length - 1; i++) {
            if (holidays[i + 1] - holidays[i] <= ONE_DAY_MS + 1000) return true;
        }
        return false;
    }
}