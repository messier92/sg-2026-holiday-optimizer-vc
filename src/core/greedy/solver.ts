import { buildCalendarDays } from '../shared/calendar/index.ts';
import { checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
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
        input.rules.restrictions
    );
    const availablePTO = upfront.availablePTO;

    // Seed with required PTO dates
    const selectedSet = new Set<string>(upfront.requiredEligibleDates);
    if (!isPartialAllocationFeasible(calendarDays, selectedSet, input, availablePTO)) {
        return buildOptimizationResult({
            algorithmId: 'greedy',
            selectedPTODates: [],
            input,
            calendarDays,
            executionTimeMs: performance.now() - startTime,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage: 'Infeasible: required PTO dates violate consecutive PTO or spacing constraints.',
            warnings
        });
    }

    const minPTORequired = input.rules.allocation.allowUnusedPTO
        ? input.rules.allocation.minPTOToAllocate
        : availablePTO;

    let step = 0;
    let totalCandidatesEvaluated = 0;

    while (selectedSet.size < availablePTO) {
        if (signal?.aborted) {
            return buildOptimizationResult({
                algorithmId: 'greedy',
                selectedPTODates: [],
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

        // If objective is minimize_pto_consumption and current set already satisfies all hard constraints, stop!
        if (
            input.rules.objectives.primary === 'minimize_pto_consumption' &&
            selectedSet.size >= minPTORequired &&
            isAllocationHardValid(calendarDays, selectedSet, input)
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
            availablePTO
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

        // If we already meet all minimum requirements and the best candidate degrades the objective, stop
        const alreadyValid = isAllocationHardValid(calendarDays, selectedSet, input);
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

    const finalDates = Array.from(selectedSet).sort();
    const isValid = isAllocationHardValid(calendarDays, finalDates, input);
    const elapsed = performance.now() - startTime;

    if (!isValid) {
        return buildOptimizationResult({
            algorithmId: 'greedy',
            selectedPTODates: [],
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
        selectedPTODates: finalDates,
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
