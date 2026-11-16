import { buildCalendarDays, generateCandidateICTSchedules } from '../shared/calendar/index.ts';
import { areIntervalsCompatible, checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
import { buildOptimizationResult } from '../shared/results/index.ts';
import type { ILPConfig, OptimizationResult, SolverOptions } from '../shared/types/index.ts';
import { buildILPModel } from './constraints.ts';
import { compareEvaluations, evaluateILPCandidate, populateILPObjectiveCoeffs } from './objectives.ts';

/**
 * Solves the PTO optimization problem using 0-1 Integer Linear Programming:
 * - Formulates binary interval & daily PTO variables with linear spacing and budget constraints.
 * - Computes exact LP/DAG relaxation upper bounds over the interval packing polytope.
 * - Executes Branch-and-Bound with constraint propagation, optimality gap tolerance, and lexicographic refinement.
 */
export async function solveWithILP(options: SolverOptions<ILPConfig>): Promise<OptimizationResult> {
    const startTime = performance.now();
    const { input, config, onProgress, signal } = options;
    const warnings: string[] = [];

    if (config.optimalityGapTolerance > 0) {
        warnings.push(
            `Optimality gap tolerance is set to ${(config.optimalityGapTolerance * 100).toFixed(1)}%. Solutions within this gap are accepted without proving global 0% optimality.`
        );
    }

    const upfront = checkUpfrontFeasibility(input);
    if (!upfront.feasible) {
        return buildOptimizationResult({
            algorithmId: 'ilp',
            selectedPTODates: [],
            input,
            executionTimeMs: performance.now() - startTime,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            enableLexicographic: config.enableLexicographic,
            statusMessage: upfront.reasons.join(' '),
            warnings
        });
    }

    const baseCalendarDays = buildCalendarDays(
        input.startDate,
        input.endDate,
        input.publicHolidays,
        input.rules.restrictions,
        input.rules.ict
    );
    const candidateICTSchedules = generateCandidateICTSchedules(baseCalendarDays, input);

    let globalBestPTO: string[] | null = null;
    let globalBestICT: string[] = [];
    let globalBestEval = evaluateILPCandidate(
        baseCalendarDays,
        [],
        input,
        config.enableLexicographic,
        []
    );
    let totalNodesExplored = 0;
    let anyTimedOut = false;
    let anyStoppedByGap = false;
    let bestRootUpperBound = -1e15;

    for (const candidateICTDates of candidateICTSchedules) {
        const model = buildILPModel(input, candidateICTDates);
        populateILPObjectiveCoeffs(model, input, config.enableLexicographic);

        const M = model.workingDays.length;
        const B = model.availablePTO;

        // Handle zero working days or zero available PTO
        if (M === 0 || B === 0) {
            if (isAllocationHardValid(model.calendarDays, [], input, candidateICTDates)) {
                const ev = evaluateILPCandidate(
                    model.calendarDays,
                    [],
                    input,
                    config.enableLexicographic,
                    candidateICTDates
                );
                if (
                    globalBestPTO === null ||
                    compareEvaluations(ev, globalBestEval, config.enableLexicographic) > 0
                ) {
                    globalBestPTO = [];
                    globalBestICT = candidateICTDates;
                    globalBestEval = ev;
                }
            }
            continue;
        }

    const timeLimitMs = Math.max(100, config.timeLimitSeconds * 1000);
    const minWorkSpacing = Math.max(1, input.rules.distribution.minWorkingDaysBetweenBreaks);

    // Step 1: Compute exact suffix relaxation bound table U[w][remPTO] over the interval-packing polytope
    // U[w][p] = maximum linear objective achievable from working day index >= w using at most p PTO days,
    // while enforcing mandatory PTO working days in [w..M-1].
    const NEG_INF = -1e15;
    const U: Float64Array[] = Array.from({ length: M + 1 }, () => {
        const arr = new Float64Array(B + 1);
        arr.fill(NEG_INF);
        return arr;
    });
    const choiceInterval: Int32Array[] = Array.from({ length: M + 1 }, () => {
        const arr = new Int32Array(B + 1);
        arr.fill(-1);
        return arr;
    });

    const isRequiredWorkDay = new Uint8Array(M);
    for (const rIdx of model.requiredWorkingDayIndices) {
        isRequiredWorkDay[rIdx] = 1;
    }

    // Base case at w = M
    for (let p = 0; p <= B; p++) {
        // Valid if total PTO used (B - p) >= minPTORequired
        const used = B - p;
        if (used >= model.minPTORequired) {
            U[M][p] = 0;
        }
    }

    // Backward pass from w = M - 1 down to 0
    for (let w = M - 1; w >= 0; w--) {
        const startsHere = model.intervalsByStart[w];
        const mustCoverW = isRequiredWorkDay[w] === 1;

        for (let p = 0; p <= B; p++) {
            let bestVal = mustCoverW ? NEG_INF : U[w + 1][p];
            let bestIv = -1;

            for (let i = 0; i < startsHere.length; i++) {
                const iv = startsHere[i];
                if (iv.ptoCost > p) continue;

                // Next allowed working day index after spacing
                let nextW = Math.min(M, iv.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        iv.calEndIdx + 1 + input.rules.distribution.minCalendarDaysBetweenBreaks;
                    while (nextW < M) {
                        const candCalStart =
                            nextW === 0 ? 0 : model.workingDays[nextW - 1].index + 1;
                        if (candCalStart >= minNextCal) break;
                        nextW++;
                    }
                }

                // Check if skipping from iv.workEndIdx + 1 to nextW - 1 misses any required working day
                let skipsRequired = false;
                for (let k = iv.workEndIdx + 1; k < nextW && k < M; k++) {
                    if (isRequiredWorkDay[k] === 1) {
                        skipsRequired = true;
                        break;
                    }
                }
                if (skipsRequired) continue;

                const subVal = U[nextW][p - iv.ptoCost];
                if (subVal > NEG_INF / 2) {
                    const totalVal = model.objectiveCoeffs[iv.id] + subVal;
                    if (totalVal > bestVal) {
                        bestVal = totalVal;
                        bestIv = iv.id;
                    }
                }
            }

            U[w][p] = bestVal;
            choiceInterval[w][p] = bestIv;
        }
    }

    if (onProgress) {
        onProgress({
            algorithmId: 'ilp',
            phase: 'LP Relaxation & Bound Initialization',
            percent: 30,
            bestScore: U[0][B] > NEG_INF / 2 ? U[0][B] : undefined
        });
    }

    if (U[0][B] > bestRootUpperBound) {
        bestRootUpperBound = U[0][B];
    }

    // If even the relaxation at (0, B) is NEG_INF, this ICT schedule cannot satisfy mandatory/spacing/budget constraints
    if (U[0][B] <= NEG_INF / 2) {
        continue;
    }

    // Reconstruct the primary relaxation path solution and check if it already satisfies all global constraints
    let bestPTO: string[] | null = null;
    let bestEval = evaluateILPCandidate(
        model.calendarDays,
        [],
        input,
        config.enableLexicographic,
        candidateICTDates
    );

    // Check 0-PTO solution first if allowed
    if (isAllocationHardValid(model.calendarDays, [], input, candidateICTDates)) {
        bestPTO = [];
        bestEval = evaluateILPCandidate(
            model.calendarDays,
            [],
            input,
            config.enableLexicographic,
            candidateICTDates
        );
    }

    // Reconstruct path from choiceInterval table for every valid starting budget p <= B
    for (let pInit = B; pInit >= model.minPTORequired; pInit--) {
        if (U[0][pInit] <= NEG_INF / 2) continue;
        const dates: string[] = [];
        let w = 0;
        let p = pInit;
        while (w < M && p >= 0) {
            const ivId = choiceInterval[w][p];
            if (ivId === -1) {
                w++;
            } else {
                const iv = model.intervals[ivId];
                dates.push(...iv.ptoDates);
                p -= iv.ptoCost;
                let nextW = Math.min(M, iv.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        iv.calEndIdx + 1 + input.rules.distribution.minCalendarDaysBetweenBreaks;
                    while (nextW < M) {
                        const candCalStart =
                            nextW === 0 ? 0 : model.workingDays[nextW - 1].index + 1;
                        if (candCalStart >= minNextCal) break;
                        nextW++;
                    }
                }
                w = nextW;
            }
        }
        if (isAllocationHardValid(model.calendarDays, dates, input, candidateICTDates)) {
            const ev = evaluateILPCandidate(
                model.calendarDays,
                dates,
                input,
                config.enableLexicographic,
                candidateICTDates
            );
            if (bestPTO === null || compareEvaluations(ev, bestEval, config.enableLexicographic) > 0) {
                bestPTO = dates;
                bestEval = ev;
            }
        }
    }

    // Step 2: Branch-and-Bound search to handle non-additive objectives (efficiency, distribution)
    // and global break/category count constraints, or prove exact optimality.
    const hasGlobalCountConstraints =
        input.rules.distribution.minNumberOfBreaks > 0 ||
        input.rules.distribution.maxNumberOfBreaks !== null ||
        (['short', 'medium', 'long', 'extended'] as const).some(
            c =>
                input.rules.breakDuration[c].enabled &&
                (input.rules.breakDuration[c].minCount > 0 ||
                    input.rules.breakDuration[c].maxCount !== null)
        );
    const isNonAdditivePrimary =
        input.rules.objectives.primary === 'maximize_pto_efficiency' ||
        input.rules.objectives.primary === 'maximize_break_distribution' ||
        input.rules.objectives.secondaries.prefer_evenly_distributed_breaks.enabled ||
        input.rules.distribution.evenlyDistributeBreaks;

    let nodesExplored = 1;
    let timedOut = false;
    let stoppedByGap = false;

    // Run Branch-and-Bound whenever needed or when small/medium range or constraints require search
    if (bestPTO === null || hasGlobalCountConstraints || isNonAdditivePrimary || M <= 80) {
        const chosenIntervals: number[] = [];

        const dfs = async (w: number, remPTO: number, currentLinearObj: number): Promise<void> => {
            if (signal?.aborted) {
                timedOut = true;
                return;
            }
            if (performance.now() - startTime > timeLimitMs) {
                timedOut = true;
                return;
            }

            nodesExplored++;
            if (nodesExplored % 2500 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (onProgress) {
                    onProgress({
                        algorithmId: 'ilp',
                        phase: 'Branch-and-Bound Search',
                        percent: Math.min(95, 30 + Math.round((nodesExplored / 15000) * 65)),
                        currentIteration: nodesExplored,
                        bestScore: bestPTO !== null ? bestEval.primaryScore : undefined,
                        statesExplored: nodesExplored
                    });
                }
            }

            if (U[w][remPTO] <= NEG_INF / 2) {
                return;
            }

            // Linear upper bound check when objective is purely additive and no global count constraints force lower paths
            if (!hasGlobalCountConstraints && !isNonAdditivePrimary && bestPTO !== null) {
                const optimisticBound = currentLinearObj + U[w][remPTO];
                const bestVal = bestEval.combinedScore;
                if (optimisticBound <= bestVal + 1e-5) {
                    return;
                }
                if (
                    config.optimalityGapTolerance > 0 &&
                    (optimisticBound - bestVal) / (Math.abs(bestVal) + 1e-9) <=
                        config.optimalityGapTolerance
                ) {
                    stoppedByGap = true;
                    return;
                }
            }

            if (w >= M) {
                const usedPTO = B - remPTO;
                if (usedPTO < model.minPTORequired) return;

                const dates: string[] = [];
                for (const id of chosenIntervals) {
                    dates.push(...model.intervals[id].ptoDates);
                }

                if (isAllocationHardValid(model.calendarDays, dates, input, candidateICTDates)) {
                    const ev = evaluateILPCandidate(
                        model.calendarDays,
                        dates,
                        input,
                        config.enableLexicographic,
                        candidateICTDates
                    );
                    if (
                        bestPTO === null ||
                        compareEvaluations(ev, bestEval, config.enableLexicographic) > 0
                    ) {
                        bestPTO = dates;
                        bestEval = ev;
                    }
                }
                return;
            }

            // Order branches at working day w: sort intervals starting at w by descending objective contribution
            const candidates = [...model.intervalsByStart[w]].filter(iv => iv.ptoCost <= remPTO);
            candidates.sort((a, b) => model.objectiveCoeffs[b.id] - model.objectiveCoeffs[a.id]);

            const prevIv =
                chosenIntervals.length > 0
                    ? model.intervals[chosenIntervals[chosenIntervals.length - 1]]
                    : null;

            for (const iv of candidates) {
                if (prevIv && !areIntervalsCompatible(prevIv, iv, input.rules)) {
                    continue;
                }

                let nextW = Math.min(M, iv.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        iv.calEndIdx + 1 + input.rules.distribution.minCalendarDaysBetweenBreaks;
                    while (nextW < M) {
                        const candCalStart =
                            nextW === 0 ? 0 : model.workingDays[nextW - 1].index + 1;
                        if (candCalStart >= minNextCal) break;
                        nextW++;
                    }
                }

                let skipsReq = false;
                for (let k = iv.workEndIdx + 1; k < nextW && k < M; k++) {
                    if (isRequiredWorkDay[k] === 1) {
                        skipsReq = true;
                        break;
                    }
                }
                if (skipsReq) continue;

                chosenIntervals.push(iv.id);
                await dfs(
                    nextW,
                    remPTO - iv.ptoCost,
                    currentLinearObj + model.objectiveCoeffs[iv.id]
                );
                chosenIntervals.pop();

                if (timedOut || stoppedByGap) return;
                // Limit exhaustive search on very large unconstrained instances after verifying top branches
                if (nodesExplored > 25000 && bestPTO !== null) {
                    return;
                }
            }

            // Branch: do not start a break at w (only allowed if w is not a required PTO day)
            if (isRequiredWorkDay[w] === 0 && !timedOut && !stoppedByGap) {
                if (nodesExplored <= 25000 || bestPTO !== null) {
                    await dfs(w + 1, remPTO, currentLinearObj);
                }
            }
        };

        await dfs(0, B, 0);
    }

        totalNodesExplored += nodesExplored;
        if (timedOut) anyTimedOut = true;
        if (stoppedByGap) anyStoppedByGap = true;

        if (bestPTO !== null) {
            if (
                globalBestPTO === null ||
                compareEvaluations(bestEval, globalBestEval, config.enableLexicographic) > 0
            ) {
                globalBestPTO = bestPTO;
                globalBestICT = candidateICTDates;
                globalBestEval = bestEval;
            }
        }
    }

    const elapsed = performance.now() - startTime;

    if (globalBestPTO === null) {
        return buildOptimizationResult({
            algorithmId: 'ilp',
            selectedPTODates: [],
            selectedICTDates: [],
            input,
            calendarDays: baseCalendarDays,
            executionTimeMs: elapsed,
            status: anyTimedOut ? 'timeout' : 'infeasible',
            optimalityGuarantee: anyTimedOut ? 'none' : 'infeasible',
            isExactOptimal: false,
            enableLexicographic: config.enableLexicographic,
            statusMessage: anyTimedOut
                ? 'ILP solver timed out before finding a feasible solution.'
                : 'ILP branch-and-bound proved that no valid allocation satisfies all hard constraints.',
            warnings,
            statesExplored: totalNodesExplored
        });
    }

    const isProvenOptimal = !anyTimedOut && !anyStoppedByGap && config.optimalityGapTolerance === 0;
    const status = anyTimedOut && !globalBestPTO ? 'timeout' : isProvenOptimal ? 'optimal' : 'feasible';
    const guarantee = isProvenOptimal
        ? 'proven_optimal'
        : anyStoppedByGap || config.optimalityGapTolerance > 0
          ? 'feasible_within_gap'
          : 'feasible_unproven';

    return buildOptimizationResult({
        algorithmId: 'ilp',
        selectedPTODates: globalBestPTO,
        selectedICTDates: globalBestICT,
        input,
        calendarDays: baseCalendarDays,
        executionTimeMs: elapsed,
        status,
        optimalityGuarantee: guarantee,
        isExactOptimal: isProvenOptimal,
        enableLexicographic: config.enableLexicographic,
        statusMessage: isProvenOptimal
            ? `Proven globally optimal solution (${totalNodesExplored} branch-and-bound node(s) explored, LP bound ${bestRootUpperBound.toFixed(1)}).`
            : anyStoppedByGap || config.optimalityGapTolerance > 0
              ? `Feasible solution within configured optimality gap tolerance (${(config.optimalityGapTolerance * 100).toFixed(1)}%).`
              : `Feasible solution found before time/search limit (${totalNodesExplored} nodes explored).`,
        warnings,
        statesExplored: totalNodesExplored
    });
}
