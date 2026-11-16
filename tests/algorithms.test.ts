import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PUBLIC_HOLIDAYS_2027,
    buildCalendarDays,
    createDefaultAlgorithmConfigs,
    createDefaultRules,
    evaluateObjective,
    isAllocationHardValid,
    runAlgorithmById,
    type AlgorithmId,
    type OptimizationResult,
    type PublicHoliday,
    type SharedOptimizationInput
} from '../src/core/index.ts';
import { getMaximizePTO } from '../src/lib/maxleavealgorithm.ts';

const ALL_ALGOS: AlgorithmId[] = ['ilp', 'cpsat', 'dp', 'greedy', 'genetic'];
const EXACT_ALGOS: AlgorithmId[] = ['ilp', 'cpsat', 'dp'];

async function runAllFive(input: SharedOptimizationInput): Promise<Record<AlgorithmId, OptimizationResult>> {
    const configs = createDefaultAlgorithmConfigs();
    // Use compact GA settings in unit tests for fast deterministic execution
    configs.genetic.populationSize = 40;
    configs.genetic.maxGenerations = 80;
    configs.genetic.earlyStoppingGenerations = 20;

    const out = {} as Record<AlgorithmId, OptimizationResult>;
    for (const id of ALL_ALGOS) {
        out[id] = await runAlgorithmById(id, input, configs);
    }
    return out;
}

function assertCommonInvariants(
    result: OptimizationResult,
    input: SharedOptimizationInput
): void {
    const holidaySet = new Set(input.publicHolidays.map(h => h.date));
    const availablePTO = Math.max(0, input.ptoAllowance - input.rules.allocation.reservePTODays);

    // PTO consumption never exceeds available allowance
    assert.ok(
        result.totalPTOConsumed <= availablePTO,
        `${result.algorithmId}: PTO consumed (${result.totalPTOConsumed}) > available (${availablePTO})`
    );
    assert.equal(result.selectedPTODates.length, result.totalPTOConsumed);

    for (const dStr of result.selectedPTODates) {
        // Within date range
        assert.ok(
            dStr >= input.startDate && dStr <= input.endDate,
            `${result.algorithmId}: PTO date ${dStr} outside [${input.startDate}, ${input.endDate}]`
        );

        // Never on weekend
        const [y, m, d] = dStr.split('-').map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        assert.ok(
            dow !== 0 && dow !== 6,
            `${result.algorithmId}: PTO date ${dStr} allocated on weekend (day ${dow})`
        );

        // Never on public holiday
        assert.ok(
            !holidaySet.has(dStr),
            `${result.algorithmId}: PTO date ${dStr} allocated on public holiday`
        );
    }

    // If presented as optimal or feasible, all hard constraints MUST be satisfied
    if (result.status === 'optimal' || result.status === 'feasible') {
        assert.equal(
            result.validation.isValid,
            true,
            `${result.algorithmId}: Status is ${result.status} but validation.isValid is false`
        );
    }

    // Heuristic algorithms must never claim exact optimality
    if (result.algorithmId === 'greedy' || result.algorithmId === 'genetic') {
        assert.equal(result.isExactOptimal, false);
        if (result.status !== 'infeasible' && result.status !== 'timeout') {
            assert.equal(result.optimalityGuarantee, 'heuristic');
        }
    }

    // ICT Invariants
    const ict = input.rules.ict;
    const availableICT = ict?.enabled ? Math.max(0, ict.annualICTQuota - ict.reserveICTDays) : 0;
    assert.ok(
        result.totalICTConsumed <= availableICT,
        `${result.algorithmId}: ICT consumed (${result.totalICTConsumed}) > available ICT (${availableICT})`
    );
    assert.equal(result.selectedICTDates.length, result.totalICTConsumed);
    assert.equal(result.ictPeriods.length, result.numberOfICTPeriods);

    const periodSum = result.ictPeriods.reduce((s, p) => s + p.duration, 0);
    assert.equal(
        periodSum,
        result.totalICTConsumed,
        `${result.algorithmId}: sum of ICT period durations (${periodSum}) != totalICTConsumed (${result.totalICTConsumed})`
    );

    const ptoSet = new Set(result.selectedPTODates);
    for (const ictDate of result.selectedICTDates) {
        assert.ok(
            !ptoSet.has(ictDate),
            `${result.algorithmId}: date ${ictDate} allocated as both PTO and ICT`
        );
        assert.ok(
            ictDate >= input.startDate && ictDate <= input.endDate,
            `${result.algorithmId}: ICT date ${ictDate} outside [${input.startDate}, ${input.endDate}]`
        );
    }

    // Component totals reconciliation on every continuous break
    for (const b of result.breaks) {
        assert.equal(
            b.ptoUsed + b.ictUsed + b.weekendDays + b.publicHolidayDays,
            b.duration,
            `${result.algorithmId}: Break [${b.startDate}..${b.endDate}] components (${b.ptoUsed} PTO + ${b.ictUsed} ICT + ${b.weekendDays} Wknd + ${b.publicHolidayDays} PH) != duration (${b.duration})`
        );
    }
}

/**
 * Brute-force exact enumerator for small date ranges (M <= 15 working days)
 * to verify exact optimality of ILP, CP-SAT, and DP.
 */
function bruteForceOptimalScore(input: SharedOptimizationInput): number | null {
    const calDays = buildCalendarDays(
        input.startDate,
        input.endDate,
        input.publicHolidays,
        input.rules.restrictions
    );
    const workingDays = calDays.filter(d => d.isEligibleWorkingDay);
    const M = workingDays.length;
    const totalMasks = 1 << M;

    let bestPrimary: number | null = null;
    for (let mask = 0; mask < totalMasks; mask++) {
        const ptoDates: string[] = [];
        for (let i = 0; i < M; i++) {
            if ((mask & (1 << i)) !== 0) {
                ptoDates.push(workingDays[i].date);
            }
        }
        if (isAllocationHardValid(calDays, ptoDates, input)) {
            const ev = evaluateObjective(calDays, ptoDates, input, true);
            if (bestPrimary === null || ev.primaryScore > bestPrimary) {
                bestPrimary = ev.primaryScore;
            }
        }
    }

    return bestPrimary;
}

test('1. No public holidays (weekends only) + brute-force verification', async () => {
    const input: SharedOptimizationInput = {
        startDate: '2027-06-01',
        endDate: '2027-06-20',
        ptoAllowance: 2,
        publicHolidays: [],
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    const bruteBest = bruteForceOptimalScore(input);
    assert.ok(bruteBest !== null);

    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.ok(results[id].status === 'optimal' || results[id].status === 'feasible');
    }

    for (const id of EXACT_ALGOS) {
        assert.equal(results[id].primaryObjectiveScore, bruteBest);
        assert.equal(results[id].isExactOptimal, true);
    }
});

test('2. Public holidays adjacent to weekends (Good Friday 2027-03-26)', async () => {
    const input: SharedOptimizationInput = {
        startDate: '2027-03-20',
        endDate: '2027-04-04',
        ptoAllowance: 1,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    const bruteBest = bruteForceOptimalScore(input);
    assert.equal(bruteBest, 4); // Good Friday (Fri Mar 26) + Sat + Sun + Thu Mar 25 or Mon Mar 29 = 4 days off

    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalCalendarDaysOff, 4);
        assert.equal(results[id].totalPTOConsumed, 1);
    }
});

test('3. Consecutive public holidays + week fill', async () => {
    const customHolidays: PublicHoliday[] = [
        { date: '2027-05-17', name: 'Holiday 1 (Mon)' },
        { date: '2027-05-18', name: 'Holiday 2 (Tue)' }
    ];
    const input: SharedOptimizationInput = {
        startDate: '2027-05-15',
        endDate: '2027-05-23',
        ptoAllowance: 3,
        publicHolidays: customHolidays,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    const bruteBest = bruteForceOptimalScore(input);
    assert.equal(bruteBest, 9); // Full 9-day break from Sat May 15 to Sun May 23 using Wed, Thu, Fri

    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalCalendarDaysOff, 9);
        assert.deepEqual(results[id].selectedPTODates, [
            '2027-05-19',
            '2027-05-20',
            '2027-05-21'
        ]);
    }
});

test('4. PTO allowance of zero', async () => {
    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 0,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalPTOConsumed, 0);
        assert.deepEqual(results[id].selectedPTODates, []);
        assert.equal(results[id].validation.isValid, true);
    }
});

test('5. PTO allowance smaller than required', async () => {
    const rules = createDefaultRules();
    rules.allocation.minPTOToAllocate = 5;

    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assert.equal(results[id].status, 'infeasible');
        assert.equal(results[id].validation.isValid, false);
        assert.equal(results[id].selectedPTODates.length, 0);
    }
});

test('6. All dates marked as blackout dates', async () => {
    const calDays = buildCalendarDays('2027-06-01', '2027-06-15', PUBLIC_HOLIDAYS_2027);
    const allWorkingDates = calDays.filter(d => d.isEligibleWorkingDay).map(d => d.date);

    // Case 6a: Unused PTO allowed -> valid 0 PTO allocation
    const rulesAllowed = createDefaultRules();
    rulesAllowed.allocation.allowUnusedPTO = true;
    rulesAllowed.restrictions.blackoutDates = allWorkingDates;
    const inputAllowed: SharedOptimizationInput = {
        startDate: '2027-06-01',
        endDate: '2027-06-15',
        ptoAllowance: 4,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesAllowed
    };
    const resAllowed = await runAllFive(inputAllowed);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(resAllowed[id], inputAllowed);
        assert.equal(resAllowed[id].totalPTOConsumed, 0);
    }

    // Case 6b: Minimum PTO required > 0 -> infeasible
    const rulesRequired = createDefaultRules();
    rulesRequired.restrictions.blackoutDates = allWorkingDates;
    rulesRequired.allocation.minPTOToAllocate = 1;
    const inputRequired: SharedOptimizationInput = {
        startDate: '2027-06-01',
        endDate: '2027-06-15',
        ptoAllowance: 4,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesRequired
    };
    const resRequired = await runAllFive(inputRequired);
    for (const id of ALL_ALGOS) {
        assert.equal(resRequired[id].status, 'infeasible');
        assert.equal(resRequired[id].validation.isValid, false);
    }
});

test('7. Conflicting required and prohibited dates', async () => {
    const rules = createDefaultRules();
    rules.restrictions.requiredPTODates = ['2027-05-18'];
    rules.restrictions.blackoutDates = ['2027-05-18'];

    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 5,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assert.equal(results[id].status, 'infeasible');
        assert.equal(results[id].validation.isValid, false);
        assert.equal(results[id].selectedPTODates.length, 0);
    }
});

test('8. Minimum spacing between breaks', async () => {
    const rules = createDefaultRules();
    rules.distribution.minWorkingDaysBetweenBreaks = 10;

    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-06-30',
        ptoAllowance: 5,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].validation.isValid, true);
        const spacingRule = results[id].validation.hardConstraints.find(
            c => c.code === 'BREAK_SPACING'
        );
        assert.equal(spacingRule?.satisfied, true);
    }
});

test('9. Maximum consecutive PTO days', async () => {
    const rules = createDefaultRules();
    rules.allocation.maxConsecutivePTOWorkingDays = 1;

    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-06-30',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        const consecConstraint = results[id].validation.hardConstraints.find(
            c => c.code === 'MAX_CONSECUTIVE_PTO'
        );
        assert.equal(consecConstraint?.satisfied, true);
    }
});

test('10. Overlapping break categories vs non-overlapping category counts', async () => {
    const baseRules = createDefaultRules();
    baseRules.breakDuration.allowOverlappingCategoryCounts = false;

    const inputNonOverlap: SharedOptimizationInput = {
        startDate: '2027-05-14',
        endDate: '2027-05-24',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: baseRules
    };

    const resNonOverlap = await runAllFive(inputNonOverlap);
    // 9-day break (May 15-23) is Medium (>= 7 and < 10): should NOT increment short when overlapping is false
    assert.equal(resNonOverlap.ilp.categoryCounts.medium, 1);
    assert.equal(resNonOverlap.ilp.categoryCounts.short, 0);

    const overlapRules = createDefaultRules();
    overlapRules.breakDuration.allowOverlappingCategoryCounts = true;
    const inputOverlap: SharedOptimizationInput = {
        ...inputNonOverlap,
        rules: overlapRules
    };
    const resOverlap = await runAllFive(inputOverlap);
    // With overlapping enabled, a 9-day break satisfies both Short (>=4) and Medium (>=7)
    assert.equal(resOverlap.ilp.categoryCounts.medium, 1);
    assert.equal(resOverlap.ilp.categoryCounts.short, 1);
});

test('11. Date ranges crossing calendar years (2026-12-20 to 2027-01-10)', async () => {
    const crossYearHolidays: PublicHoliday[] = [
        { date: '2026-12-25', name: 'Christmas 2026' },
        ...PUBLIC_HOLIDAYS_2027
    ];
    const input: SharedOptimizationInput = {
        startDate: '2026-12-20',
        endDate: '2027-01-10',
        ptoAllowance: 4,
        publicHolidays: crossYearHolidays,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].validation.isValid, true);
        assert.ok(results[id].totalCalendarDaysOff >= 8);
    }
    for (const id of EXACT_ALGOS) {
        assert.equal(results[id].totalCalendarDaysOff, 10);
    }
});

test('12. Leap years (February 2028 includes 2028-02-29)', async () => {
    const leapDays = buildCalendarDays('2028-02-01', '2028-03-05', []);
    assert.ok(leapDays.some(d => d.date === '2028-02-29'));

    const input: SharedOptimizationInput = {
        startDate: '2028-02-24',
        endDate: '2028-03-05',
        ptoAllowance: 2,
        publicHolidays: [{ date: '2028-02-29', name: 'Leap Day Holiday' }],
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.ok(!results[id].selectedPTODates.includes('2028-02-29'));
    }
});

test('13. Infeasible configurations (impossible break count requirements)', async () => {
    const rules = createDefaultRules();
    rules.breakDuration.extended.enabled = true;
    rules.breakDuration.extended.minCount = 3; // Impossible to get three 14-day breaks with 2 PTO days

    const input: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-06-30',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assert.equal(results[id].status, 'infeasible');
        assert.equal(results[id].validation.isValid, false);
        assert.equal(results[id].selectedPTODates.length, 0);
    }
});

test('14. Multiple equally optimal solutions', async () => {
    // Two identical normal weeks with no holidays: 1 PTO day can produce a 3-day weekend on any Mon or Fri
    const input: SharedOptimizationInput = {
        startDate: '2027-06-05',
        endDate: '2027-06-20',
        ptoAllowance: 1,
        publicHolidays: [],
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of EXACT_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalCalendarDaysOff, 3);
        assert.equal(results[id].totalPTOConsumed, 1);
    }
});

test('15. Unused PTO policy and minimize_pto_consumption objective', async () => {
    const rules = createDefaultRules();
    rules.allocation.allowUnusedPTO = true;
    rules.distribution.minNumberOfBreaks = 1;
    rules.objectives.primary = 'minimize_pto_consumption';

    const input: SharedOptimizationInput = {
        startDate: '2027-10-23',
        endDate: '2027-11-02',
        ptoAllowance: 5,
        publicHolidays: PUBLIC_HOLIDAYS_2027, // Deepavali is Thu 2027-10-28 -> 1 PTO on Fri 2027-10-29 makes a 4-day break!
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalPTOConsumed, 1);
        assert.equal(results[id].remainingPTOAllowance, 4);
        assert.deepEqual(results[id].selectedPTODates, ['2027-10-29']);
    }
});

test('16. Date ranges containing no working days (weekend-only range)', async () => {
    const input: SharedOptimizationInput = {
        startDate: '2027-02-06', // Sat CNY Day 1
        endDate: '2027-02-08', // Mon CNY off-in-lieu
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalPTOConsumed, 0);
        assert.equal(results[id].selectedPTODates.length, 0);
    }
});

test('17. Genetic Algorithm deterministic reproducibility with fixed random seed', async () => {
    const input: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        ptoAllowance: 10,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: createDefaultRules()
    };

    const configs1 = createDefaultAlgorithmConfigs();
    configs1.genetic.randomSeed = 12345;
    configs1.genetic.populationSize = 50;
    configs1.genetic.maxGenerations = 60;

    const configs2 = createDefaultAlgorithmConfigs();
    configs2.genetic.randomSeed = 12345;
    configs2.genetic.populationSize = 50;
    configs2.genetic.maxGenerations = 60;

    const run1 = await runAlgorithmById('genetic', input, configs1);
    const run2 = await runAlgorithmById('genetic', input, configs2);

    assert.deepEqual(run1.selectedPTODates, run2.selectedPTODates);
    assert.equal(run1.objectiveScore, run2.objectiveScore);
});

test('18. Full-year Singapore 2027 integration across all 5 algorithms & legacy planner', async () => {
    const legacySuggested = getMaximizePTO(
        '2027-01-01',
        7,
        PUBLIC_HOLIDAYS_2027,
        '2027-12-31'
    );
    assert.equal(legacySuggested.length, 7);

    const input: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        ptoAllowance: 7,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: createDefaultRules()
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].validation.isValid, true);
        assert.ok(results[id].totalCalendarDaysOff >= 18);
    }
});

test('19. 15 PTO days with prohibited date range overlapping suggested PTO dates and allowUnusedPTO unchecked by default', async () => {
    const rules = createDefaultRules();
    assert.equal(rules.allocation.allowUnusedPTO, false);
    assert.equal(rules.breakDuration.short.enabled, false);
    assert.equal(rules.breakDuration.medium.enabled, false);
    assert.equal(rules.breakDuration.long.enabled, false);
    assert.equal(rules.breakDuration.extended.enabled, false);
    assert.equal(rules.breakDuration.allowOverlappingCategoryCounts, false);

    // Prohibit May 18-21 and March 8-12 (which overlap with prime holiday bridges)
    rules.restrictions.prohibitedDateRanges = [
        { id: 'p1', startDate: '2027-05-18', endDate: '2027-05-21', label: 'May block' },
        { id: 'p2', startDate: '2027-03-08', endDate: '2027-03-12', label: 'March block' }
    ];

    const input: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        ptoAllowance: 15,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].validation.isValid, true);
        assert.equal(
            results[id].totalPTOConsumed,
            15,
            `${id}: expected 15 PTO days consumed, got ${results[id].totalPTOConsumed}`
        );
        assert.equal(results[id].selectedPTODates.length, 15);
        for (const d of results[id].selectedPTODates) {
            assert.ok(
                !(d >= '2027-05-18' && d <= '2027-05-21') &&
                    !(d >= '2027-03-08' && d <= '2027-03-12'),
                `${id}: allocated prohibited date ${d}`
            );
        }
    }

    // Also verify legacy getMaximizePTO with excluded dates
    const calDays = buildCalendarDays('2027-01-01', '2027-12-31', PUBLIC_HOLIDAYS_2027, rules.restrictions);
    const excluded = new Set(calDays.filter(d => d.isBlackout).map(d => d.date));
    const legacy15 = getMaximizePTO('2027-01-01', 15, PUBLIC_HOLIDAYS_2027, '2027-12-31', excluded);
    assert.equal(legacy15.length, 15);
});

test('20. Required PTO Date Ranges and conflict detection with Prohibited Date Ranges', async () => {
    // 20a: Valid required PTO date range spanning May 18-21 (where May 20 is Vesak Day public holiday)
    const rulesValid = createDefaultRules();
    rulesValid.restrictions.requiredDateRanges = [
        { id: 'req1', startDate: '2027-05-18', endDate: '2027-05-21', label: 'May Trip' }
    ];
    const inputValid: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesValid
    };

    const resValid = await runAllFive(inputValid);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(resValid[id], inputValid);
        assert.equal(resValid[id].validation.isValid, true);
        assert.deepEqual(resValid[id].selectedPTODates, [
            '2027-05-18',
            '2027-05-19',
            '2027-05-21'
        ]);
    }

    // 20b: Conflicting required date range and prohibited date range -> infeasible
    const rulesConflict = createDefaultRules();
    rulesConflict.restrictions.requiredDateRanges = [
        { id: 'req1', startDate: '2027-05-18', endDate: '2027-05-21' }
    ];
    rulesConflict.restrictions.prohibitedDateRanges = [
        { id: 'pro1', startDate: '2027-05-19', endDate: '2027-05-25' }
    ];
    const inputConflict: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 5,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesConflict
    };

    const resConflict = await runAllFive(inputConflict);
    for (const id of ALL_ALGOS) {
        assert.equal(resConflict[id].status, 'infeasible');
        assert.equal(resConflict[id].validation.isValid, false);
        assert.equal(resConflict[id].selectedPTODates.length, 0);
    }
});

test('21. ICT Suite (Scenarios 1-5): 0 quota, 40-day quota, two 20-day periods, multiple smaller periods, and multi-month separation', async () => {
    // ICT-1: ICT allowance of zero
    const rulesZero = createDefaultRules();
    rulesZero.ict.enabled = true;
    rulesZero.ict.annualICTQuota = 0;
    const inputZero: SharedOptimizationInput = {
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesZero
    };
    const resZero = await runAllFive(inputZero);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(resZero[id], inputZero);
        assert.equal(resZero[id].totalICTConsumed, 0);
        assert.equal(resZero[id].totalPTOConsumed, 3);
    }

    // ICT-2: ICT allowance of 40 calendar days
    const rules40 = createDefaultRules();
    rules40.ict.enabled = true;
    rules40.ict.annualICTQuota = 40;
    rules40.ict.allowUnusedICTQuota = false;
    const input40: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        ptoAllowance: 5,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules40
    };
    const res40 = await runAllFive(input40);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(res40[id], input40);
        assert.equal(res40[id].totalICTConsumed, 40);
        assert.equal(res40[id].remainingICTAllowance, 0);
        assert.equal(res40[id].totalPTOConsumed, 5);
    }

    // ICT-3: ICT divided into two separate 20-day periods
    const rules2x20 = createDefaultRules();
    rules2x20.ict.enabled = true;
    rules2x20.ict.annualICTQuota = 40;
    rules2x20.ict.allowUnusedICTQuota = false;
    rules2x20.ict.minNumberOfICTPeriods = 2;
    rules2x20.ict.maxNumberOfICTPeriods = 2;
    rules2x20.ict.minPeriodDuration = 20;
    rules2x20.ict.maxPeriodDuration = 20;
    const input2x20: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-06-30',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules2x20
    };
    const res2x20 = await runAllFive(input2x20);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(res2x20[id], input2x20);
        assert.equal(res2x20[id].totalICTConsumed, 40);
        assert.equal(res2x20[id].numberOfICTPeriods, 2);
        assert.deepEqual(
            res2x20[id].ictPeriods.map(p => p.duration),
            [20, 20]
        );
    }

    // ICT-4 & ICT-5: ICT divided into multiple smaller periods (14 + 14 + 12 = 40) separated by several months
    const rulesMulti = createDefaultRules();
    rulesMulti.ict.enabled = true;
    rulesMulti.ict.annualICTQuota = 40;
    rulesMulti.ict.allowUnusedICTQuota = false;
    rulesMulti.ict.minNumberOfICTPeriods = 3;
    rulesMulti.ict.maxNumberOfICTPeriods = 3;
    rulesMulti.ict.minPeriodDuration = 12;
    rulesMulti.ict.maxPeriodDuration = 14;
    rulesMulti.ict.minCalendarDaysBetweenICTPeriods = 60;
    const inputMulti: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-12-31',
        ptoAllowance: 3,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesMulti
    };
    const resMulti = await runAllFive(inputMulti);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(resMulti[id], inputMulti);
        assert.equal(resMulti[id].totalICTConsumed, 40);
        assert.equal(resMulti[id].numberOfICTPeriods, 3);
        for (const p of resMulti[id].ictPeriods) {
            assert.ok(p.duration >= 12 && p.duration <= 14);
        }
        for (let i = 0; i < resMulti[id].ictPeriods.length - 1; i++) {
            const gap =
                resMulti[id].ictPeriods[i + 1].startIndex -
                resMulti[id].ictPeriods[i].endIndex -
                1;
            assert.ok(gap >= 60);
        }
    }
});

test('22. ICT Suite (Scenarios 6-10 & 17-18): Weekend/PH inclusion, PTO+ICT connection, unused ICT quota, separate vs combined breaks', async () => {
    // ICT-6 & ICT-7 & ICT-10: Fixed ICT period 2027-01-04 (Mon) to 2027-01-17 (Sun) = 14 calendar days
    // plus another fixed ICT period 2027-03-08 (Mon) to 2027-03-12 (Fri) containing Hari Raya Puasa (Wed 2027-03-10) = 5 calendar days
    // Total ICT consumed = 19 calendar days out of 40 (21 unused ICT days)
    const rules = createDefaultRules();
    rules.ict.enabled = true;
    rules.ict.annualICTQuota = 40;
    rules.ict.allowUnusedICTQuota = true;
    rules.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-01-04', endDate: '2027-01-17', label: 'Jan ICT' },
        { id: 'f2', startDate: '2027-03-08', endDate: '2027-03-12', label: 'Mar ICT (with PH)' }
    ];

    const input: SharedOptimizationInput = {
        startDate: '2027-01-01',
        endDate: '2027-03-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules
    };

    const results = await runAllFive(input);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(results[id], input);
        assert.equal(results[id].totalICTConsumed, 19);
        assert.equal(results[id].remainingICTAllowance, 21);
        assert.equal(results[id].numberOfICTPeriods, 2);
        assert.equal(results[id].totalPTOConsumed, 2);
        // Jan 1 (New Year's Day Fri) + Jan 2-3 (Sat-Sun) + Jan 4-17 (14d ICT) = 17-day continuous break!
        // Mar 6-7 (Sat-Sun) + Mar 8-12 (5d ICT containing Hari Raya Puasa) + Mar 13-14 (Sat-Sun) = 9-day continuous break!
        assert.ok(results[id].longestContinuousBreak >= 17);
        assert.ok(results[id].breaks.length >= 2);
    }

    // ICT-8 & ICT-9 & ICT-18: ICT connected directly to PTO and public holidays into a single continuous break
    const rulesConnect = createDefaultRules();
    rulesConnect.ict.enabled = true;
    rulesConnect.ict.annualICTQuota = 40;
    rulesConnect.ict.allowUnusedICTQuota = true;
    // Tue 2027-05-18 to Wed 2027-05-19 as ICT (2 days), adjacent to Mon May 17 (Hari Raya Haji) and Thu May 20 (Vesak Day)
    // Taking 1 PTO day on Fri 2027-05-21 connects Sat May 15..Sun May 23 into a single 9-day continuous break!
    rulesConnect.ict.fixedICTPeriods = [
        { id: 'c1', startDate: '2027-05-18', endDate: '2027-05-19', label: 'Mid-week ICT' }
    ];
    const inputConnect: SharedOptimizationInput = {
        startDate: '2027-05-15',
        endDate: '2027-05-23',
        ptoAllowance: 1,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rulesConnect
    };
    const resConnect = await runAllFive(inputConnect);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(resConnect[id], inputConnect);
        assert.equal(resConnect[id].totalICTConsumed, 2);
        assert.equal(resConnect[id].totalPTOConsumed, 1);
        assert.deepEqual(resConnect[id].selectedPTODates, ['2027-05-21']);
        assert.equal(resConnect[id].longestContinuousBreak, 9);
        assert.equal(resConnect[id].breaks.length, 1);
        const brk = resConnect[id].breaks[0];
        assert.equal(brk.ptoUsed, 1);
        assert.equal(brk.ictUsed, 2);
        assert.equal(brk.publicHolidayDays, 2);
        assert.equal(brk.weekendDays, 4);
    }
});

test('23. ICT Suite (Scenarios 11-16 & 19-20): Quota overflow, overlapping fixed ICT, PTO/ICT conflict, out-of-range, duration/spacing bounds, and 0 remaining working days', async () => {
    // ICT-11: ICT allocation exceeding available quota -> infeasible
    const rules11 = createDefaultRules();
    rules11.ict.enabled = true;
    rules11.ict.annualICTQuota = 10;
    rules11.ict.minICTDaysToAllocate = 15;
    const res11 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules11
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res11[id].status, 'infeasible');
        assert.equal(res11[id].validation.isValid, false);
    }

    // ICT-12: Fixed ICT periods that overlap -> infeasible
    const rules12 = createDefaultRules();
    rules12.ict.enabled = true;
    rules12.ict.fixedICTPeriods = [
        { id: 'o1', startDate: '2027-05-03', endDate: '2027-05-10' },
        { id: 'o2', startDate: '2027-05-08', endDate: '2027-05-14' }
    ];
    const res12 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules12
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res12[id].status, 'infeasible');
    }

    // ICT-13 & ICT-20: Fixed ICT period overlapping with Required PTO / Prohibited range -> infeasible
    const rules13 = createDefaultRules();
    rules13.ict.enabled = true;
    rules13.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-05-10', endDate: '2027-05-14' }
    ];
    rules13.restrictions.requiredDateRanges = [
        { id: 'r1', startDate: '2027-05-12', endDate: '2027-05-13' }
    ];
    const res13 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules13
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res13[id].status, 'infeasible');
    }

    // ICT-14: Fixed ICT period outside the selected date range -> infeasible
    const rules14 = createDefaultRules();
    rules14.ict.enabled = true;
    rules14.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-04-10', endDate: '2027-04-20' }
    ];
    const res14 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules14
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res14[id].status, 'infeasible');
    }

    // ICT-15: Minimum and maximum ICT period duration violation -> infeasible
    const rules15 = createDefaultRules();
    rules15.ict.enabled = true;
    rules15.ict.minPeriodDuration = 10;
    rules15.ict.maxPeriodDuration = 14;
    rules15.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-05-03', endDate: '2027-05-07' } // 5 days < min 10
    ];
    const res15 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules15
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res15[id].status, 'infeasible');
    }

    // ICT-16: Minimum spacing between ICT periods violation -> infeasible
    const rules16 = createDefaultRules();
    rules16.ict.enabled = true;
    rules16.ict.minCalendarDaysBetweenICTPeriods = 20;
    rules16.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-05-03', endDate: '2027-05-07' },
        { id: 'f2', startDate: '2027-05-12', endDate: '2027-05-16' } // only 4 days gap < 20
    ];
    const res16 = await runAllFive({
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        ptoAllowance: 2,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules16
    });
    for (const id of ALL_ALGOS) {
        assert.equal(res16[id].status, 'infeasible');
    }

    // ICT-19: No available working days for additional PTO (ICT covers entire range)
    const rules19 = createDefaultRules();
    rules19.allocation.allowUnusedPTO = true;
    rules19.ict.enabled = true;
    rules19.ict.fixedICTPeriods = [
        { id: 'f1', startDate: '2027-06-01', endDate: '2027-06-10' }
    ];
    const input19: SharedOptimizationInput = {
        startDate: '2027-06-01',
        endDate: '2027-06-10',
        ptoAllowance: 4,
        publicHolidays: PUBLIC_HOLIDAYS_2027,
        rules: rules19
    };
    const res19 = await runAllFive(input19);
    for (const id of ALL_ALGOS) {
        assertCommonInvariants(res19[id], input19);
        assert.equal(res19[id].totalICTConsumed, 10);
        assert.equal(res19[id].totalPTOConsumed, 0);
        assert.equal(res19[id].totalCalendarDaysOff, 10);
    }
});
