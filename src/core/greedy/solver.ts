import { buildCalendarDays, generateCandidateICTSchedules } from '../shared/calendar/index.ts';
import { checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
import { compareEvaluations, evaluateObjective } from '../shared/objectives/index.ts';
import { buildOptimizationResult } from '../shared/results/index.ts';
import type { GreedyConfig, OptimizationResult, SolverOptions } from '../shared/types/index.ts';
import {
    generateAndEvaluateGreedyCandidates,
    isPartialAllocationFeasible,
    rankGreedyCandidates
} from './candidate-ranking.ts';

/**
 * Solves the PTO optimization problem using an iterative constructive Greedy heuristic.
 * Clearly labeled as heuristic (`optimalityGuarantee: 'heuristic'`, `isExactOptimal: false`).
 */
export async function solveWithGreedy(options: SolverOptions<GreedyConfig>): Promise<OptimizationResult> {
    const startTime = performance.now();
    const { input, config, onProgress, signal } = options;
    const warnings: string[] = [
        `Greedy Algorithm (${config.rankingStrategy.replace(/_/g, ' ')}) is a constructive heuristic and is not guaranteed to find a globally optimal solution.`
    ];

    const upfront = checkUpfrontFeasibility(input);
    if (!upfront.feasible) {
        return buildOptimizationResult({
            algorithmId: 'greedy',
            selectedPTODates: [],
            input,
            executionTimeMs: performance.now() - startTime,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage: upfront.reasons.join(' '),
            warnings
        });
    }

    const calendarDays = buildCalendarDays(
        input.startDate,
        input.endDate,
        input.publicHolidays,
        input.rules.restrictions,
        input.rules.ict
    );
    const availablePTO = upfront.availablePTO;
    const candidateICTSchedules = generateCandidateICTSchedules(calendarDays, input);

    const minPTORequired = input.rules.allocation.allowUnusedPTO
        ? input.rules.allocation.minPTOToAllocate
        : availablePTO;

    let globalBestPTO: string[] | null = null;
    let globalBestICT: string[] = [];
    let globalBestEval = evaluateObjective(calendarDays, [], input, true, []);
    let step = 0;
    let totalCandidatesEvaluated = 0;

    for (const candidateICTDates of candidateICTSchedules) {
        const ictSet = new Set<string>(candidateICTDates);

        // Seed with required PTO dates
        const selectedSet = new Set<string>(upfront.requiredEligibleDates);
        if (!isPartialAllocationFeasible(calendarDays, selectedSet, input, availablePTO, ictSet)) {
            continue;
        }

        while (selectedSet.size < availablePTO) {
            if (signal?.aborted) {
                return buildOptimizationResult({
                    algorithmId: 'greedy',
                    selectedPTODates: [],
                    selectedICTDates: [],
                    input,
                    calendarDays,
                    executionTimeMs: performance.now() - startTime,
                    status: 'timeout',
                    optimalityGuarantee: 'none',
                    isExactOptimal: false,
                    statusMessage: 'Greedy optimization was cancelled.',
                    warnings
                });
            }

            if (
                input.rules.objectives.primary === 'minimize_pto_consumption' &&
                selectedSet.size >= minPTORequired &&
                isAllocationHardValid(calendarDays, selectedSet, input, ictSet)
            ) {
                break;
            }

            step++;
            const remainingPTO = availablePTO - selectedSet.size;
            const candidates = generateAndEvaluateGreedyCandidates(
                calendarDays,
                selectedSet,
                remainingPTO,
                input,
                availablePTO,
                ictSet
            );
            totalCandidatesEvaluated += candidates.length;

            if (candidates.length === 0) {
                break;
            }

            const ranked = rankGreedyCandidates(
                candidates,
                config.rankingStrategy,
                input.rules.objectives.primary === 'minimize_pto_consumption'
            );
            const best = ranked[0];

            const alreadyValid = isAllocationHardValid(calendarDays, selectedSet, input, ictSet);
            if (
                alreadyValid &&
                selectedSet.size >= minPTORequired &&
                best.deltaObjectiveScore <= 0 &&
                !best.helpsUnsatisfiedRequirement &&
                input.rules.allocation.allowUnusedPTO
            ) {
                break;
            }

            for (const d of best.dates) {
                selectedSet.add(d);
            }

            if (onProgress) {
                onProgress({
                    algorithmId: 'greedy',
                    phase: `Iterative Greedy Allocation (Step ${step})`,
                    percent: Math.min(95, Math.round((selectedSet.size / Math.max(1, availablePTO)) * 95)),
                    currentIteration: step,
                    statesExplored: totalCandidatesEvaluated
                });
            }

            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // If scattered 1-day picks deadlocked break spacing before reaching minPTORequired,
        // run a cluster-first consolidation pass that prefers multi-day breaks so the full PTO budget can be allocated.
        if (selectedSet.size < minPTORequired && !signal?.aborted) {
            const consolidatedSet = new Set<string>(upfront.requiredEligibleDates);
            while (consolidatedSet.size < availablePTO && !signal?.aborted) {
                step++;
                const remainingPTO = availablePTO - consolidatedSet.size;
                const candidates = generateAndEvaluateGreedyCandidates(
                    calendarDays,
                    consolidatedSet,
                    remainingPTO,
                    input,
                    availablePTO,
                    ictSet
                );
                totalCandidatesEvaluated += candidates.length;
                if (candidates.length === 0) break;

                const multiDay = candidates.filter(c => c.ptoAdded >= Math.min(remainingPTO, 3));
                const pool = multiDay.length > 0 ? multiDay : candidates;
                const ranked = rankGreedyCandidates(pool, 'max_additional_days_off', false);
                for (const d of ranked[0].dates) {
                    consolidatedSet.add(d);
                }
            }

            if (consolidatedSet.size > selectedSet.size) {
                selectedSet.clear();
                for (const d of consolidatedSet) selectedSet.add(d);
            }
        }

        const finalDates = Array.from(selectedSet).sort();
        if (isAllocationHardValid(calendarDays, finalDates, input, candidateICTDates)) {
            const ev = evaluateObjective(calendarDays, finalDates, input, true, candidateICTDates);
            if (globalBestPTO === null || compareEvaluations(ev, globalBestEval, true) > 0) {
                globalBestPTO = finalDates;
                globalBestICT = candidateICTDates;
                globalBestEval = ev;
            }
        }
    }

    const elapsed = performance.now() - startTime;

    if (globalBestPTO === null) {
        return buildOptimizationResult({
            algorithmId: 'greedy',
            selectedPTODates: [],
            selectedICTDates: [],
            input,
            calendarDays,
            executionTimeMs: elapsed,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage:
                'Greedy heuristic could not construct an allocation satisfying all hard constraints.',
            warnings,
            statesExplored: totalCandidatesEvaluated
        });
    }

    return buildOptimizationResult({
        algorithmId: 'greedy',
        selectedPTODates: globalBestPTO,
        selectedICTDates: globalBestICT,
        input,
        calendarDays,
        executionTimeMs: elapsed,
        status: 'feasible',
        optimalityGuarantee: 'heuristic',
        isExactOptimal: false,
        statusMessage: `Heuristic solution generated in ${step} greedy step(s) using "${config.rankingStrategy.replace(/_/g, ' ')}" ranking (${totalCandidatesEvaluated} candidate evaluations).`,
        warnings,
        statesExplored: totalCandidatesEvaluated
    });
}
