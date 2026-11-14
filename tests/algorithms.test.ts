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
