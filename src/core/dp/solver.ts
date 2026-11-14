import { buildCalendarDays } from '../shared/calendar/index.ts';
import { checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
import { compareEvaluations, evaluateObjective } from '../shared/objectives/index.ts';
import { buildOptimizationResult } from '../shared/results/index.ts';
import type { DPConfig, OptimizationResult, SolverOptions } from '../shared/types/index.ts';
import { estimateDPComplexity, getDPStateKey, reconstructDPSelectedDates } from './state.ts';
import { evaluateClosedBreakGain, expandDPStateTransitions } from './transitions.ts';
import type { DPStateNode } from './types.ts';

/**
 * Solves the PTO optimization problem using chronological Day-by-Day Dynamic Programming
 * with state memoization, dominance pruning, and backpointer reconstruction.
 */
export async function solveWithDP(options: SolverOptions<DPConfig>): Promise<OptimizationResult> {
    const startTime = performance.now();
    const { input, config, onProgress, signal } = options;
    const warnings: string[] = [];

    const upfront = checkUpfrontFeasibility(input);
    if (!upfront.feasible) {
        return buildOptimizationResult({
            algorithmId: 'dp',
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
    const N = calendarDays.length;
    const availablePTO = upfront.availablePTO;

    const complexity = estimateDPComplexity(N, input, config);
    if (complexity.warningMessage) {
        warnings.push(complexity.warningMessage);
    }
    for (const note of complexity.unsupportedNotes) {
        warnings.push(note);
    }

    if (N === 0) {
        return buildOptimizationResult({
            algorithmId: 'dp',
            selectedPTODates: [],
            input,
            calendarDays,
            executionTimeMs: performance.now() - startTime,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage: 'Date range contains no calendar days.',
            warnings
        });
    }

    const trackGlobalCounts =
        input.rules.distribution.minNumberOfBreaks > 0 ||
        input.rules.distribution.maxNumberOfBreaks !== null ||
        (['short', 'medium', 'long', 'extended'] as const).some(
            c =>
                input.rules.breakDuration[c].enabled &&
                (input.rules.breakDuration[c].minCount > 0 ||
                    input.rules.breakDuration[c].maxCount !== null)
        );

    const initialState: DPStateNode = {
        dayIndex: 0,
        remPTO: availablePTO,
        curOffDays: 0,
        curBreakPTO: 0,
        curConsecPTO: 0,
        workCooldown: 0,
        calCooldown: 0,
        qualifyingBreaks: 0,
        shortCount: 0,
        mediumCount: 0,
        longCount: 0,
        extendedCount: 0,
        accObjective: 0,
        totalBreakDaysOff: 0,
        parent: null,
        tookPTOOnPrevDay: false
    };

    let currentLayer: DPStateNode[] = [initialState];
    let totalStatesExplored = 1;
    let stateLimitExceeded = false;
    let aborted = false;

    const calendarDates = calendarDays.map(d => d.date);

    for (let dayIdx = 0; dayIdx < N; dayIdx++) {
        if (signal?.aborted) {
            aborted = true;
            break;
        }

        if (dayIdx % 25 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (onProgress) {
                onProgress({
                    algorithmId: 'dp',
                    phase: `Day-by-Day Transition (Day ${dayIdx + 1} / ${N})`,
                    percent: Math.min(95, Math.round(((dayIdx + 1) / N) * 90)),
                    currentIteration: dayIdx + 1,
                    maxIterations: N,
                    statesExplored: totalStatesExplored,
                    warning: complexity.warningMessage
                });
            }
        }

        const day = calendarDays[dayIdx];

        if (config.enableMemoization) {
            const nextMap = new Map<string, DPStateNode>();

            for (let i = 0; i < currentLayer.length; i++) {
                const st = currentLayer[i];
                const children = expandDPStateTransitions(st, day, input);

                for (let j = 0; j < children.length; j++) {
                    const child = children[j];
                    totalStatesExplored++;

                    const key = getDPStateKey(child, input, trackGlobalCounts);
                    const existing = nextMap.get(key);
                    if (!existing || child.accObjective > existing.accObjective) {
                        nextMap.set(key, child);
                    }
                }

                if (totalStatesExplored >= config.stateExplorationLimit) {
                    stateLimitExceeded = true;
                    break;
                }
            }

            let nextLayer = Array.from(nextMap.values());
            if (nextLayer.length > config.maxStateCount) {
                stateLimitExceeded = true;
                nextLayer.sort((a, b) => b.accObjective - a.accObjective);
                nextLayer = nextLayer.slice(0, config.maxStateCount);
            }

            currentLayer = nextLayer;
        } else {
            // Unmemoized tree expansion
            let nextLayer: DPStateNode[] = [];
            for (let i = 0; i < currentLayer.length; i++) {
                const st = currentLayer[i];
                const children = expandDPStateTransitions(st, day, input);
                for (let j = 0; j < children.length; j++) {
                    nextLayer.push(children[j]);
                    totalStatesExplored++;
                    if (totalStatesExplored >= config.stateExplorationLimit) {
                        stateLimitExceeded = true;
                        break;
                    }
                }
                if (stateLimitExceeded) break;
            }

            if (nextLayer.length > config.maxStateCount) {
                stateLimitExceeded = true;
                nextLayer.sort((a, b) => b.accObjective - a.accObjective);
                nextLayer = nextLayer.slice(0, config.maxStateCount);
            }
            currentLayer = nextLayer;
        }

        if (currentLayer.length === 0) {
            break;
        }

        if (stateLimitExceeded) {
            // Fast-forward remaining days deterministically (only taking required PTO) so we still reach day N
            warnings.push(
                `DP state exploration or active state limit (${config.maxStateCount.toLocaleString()} max states / ${config.stateExplorationLimit.toLocaleString()} exploration limit) was reached at day ${dayIdx + 1}/${N}. States were pruned; global optimality is not guaranteed.`
            );
            for (let remIdx = dayIdx + 1; remIdx < N; remIdx++) {
                const remDay = calendarDays[remIdx];
                const nextMap = new Map<string, DPStateNode>();
                const beamWidth = Math.min(250, config.maxStateCount);
                currentLayer.sort((a, b) => b.accObjective - a.accObjective);
                const beam = currentLayer.slice(0, beamWidth);

                for (const st of beam) {
                    const children = expandDPStateTransitions(st, remDay, input);
                    for (const child of children) {
                        const key = getDPStateKey(child, input, false);
                        const existing = nextMap.get(key);
                        if (!existing || child.accObjective > existing.accObjective) {
                            nextMap.set(key, child);
                        }
                    }
                }
                currentLayer = Array.from(nextMap.values());
                if (currentLayer.length === 0) break;
            }
            break;
        }
    }

    if (aborted) {
        return buildOptimizationResult({
            algorithmId: 'dp',
            selectedPTODates: [],
            input,
            calendarDays,
            executionTimeMs: performance.now() - startTime,
            status: 'timeout',
            optimalityGuarantee: 'none',
            isExactOptimal: false,
            statusMessage: 'Dynamic Programming optimization was cancelled.',
            warnings,
            statesExplored: totalStatesExplored
        });
    }

    // Close any open off-day block at the end of the date range (day N) and evaluate terminal states
    let bestPTO: string[] | null = null;
    let bestEval = evaluateObjective(calendarDays, [], input, true);

    // Sort terminal states by closed objective descending and validate top candidates
    const scoredTerminals = currentLayer.map(st => {
        const tailGain = evaluateClosedBreakGain(st.curOffDays, st.curBreakPTO, input);
        return {
            state: st,
            closedScore: st.accObjective + tailGain.objectiveDelta,
            finalQualifying: st.qualifyingBreaks + (tailGain.isQualifying ? 1 : 0)
        };
    });

    scoredTerminals.sort((a, b) => b.closedScore - a.closedScore);

    const minPTORequired = input.rules.allocation.allowUnusedPTO
        ? input.rules.allocation.minPTOToAllocate
        : availablePTO;

    let checkedCount = 0;
    for (const item of scoredTerminals) {
        const usedPTO = availablePTO - item.state.remPTO;
        if (usedPTO < minPTORequired) continue;
        if (item.finalQualifying < input.rules.distribution.minNumberOfBreaks) continue;
        if (
            input.rules.distribution.maxNumberOfBreaks !== null &&
            item.finalQualifying > input.rules.distribution.maxNumberOfBreaks
        ) {
            continue;
        }

        const dates = reconstructDPSelectedDates(item.state, calendarDates);
        if (isAllocationHardValid(calendarDays, dates, input)) {
            const ev = evaluateObjective(calendarDays, dates, input, true);
            if (bestPTO === null || compareEvaluations(ev, bestEval, true) > 0) {
                bestPTO = dates;
                bestEval = ev;
            }
            checkedCount++;
            if (checkedCount >= 120) break;
        }
    }

    const elapsed = performance.now() - startTime;

    if (bestPTO === null) {
        return buildOptimizationResult({
            algorithmId: 'dp',
            selectedPTODates: [],
            input,
            calendarDays,
            executionTimeMs: elapsed,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage:
                'Dynamic Programming explored all reachable state transitions and found no valid allocation satisfying all hard constraints.',
            warnings,
            statesExplored: totalStatesExplored
        });
    }

    const isExact = !stateLimitExceeded && complexity.unsupportedNotes.length === 0;

    return buildOptimizationResult({
        algorithmId: 'dp',
        selectedPTODates: bestPTO,
        input,
        calendarDays,
        executionTimeMs: elapsed,
        status: isExact ? 'optimal' : 'feasible',
        optimalityGuarantee: isExact ? 'proven_optimal' : 'feasible_unproven',
        isExactOptimal: isExact,
        statusMessage: isExact
            ? `Dynamic Programming proven optimal solution (${totalStatesExplored.toLocaleString()} states explored across ${N} days).`
            : `Dynamic Programming feasible solution (${totalStatesExplored.toLocaleString()} states explored; state pruning or non-separable objective active).`,
        warnings,
        statesExplored: totalStatesExplored
    });
}
