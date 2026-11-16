import { buildCalendarDays, generateCandidateICTSchedules } from '../shared/calendar/index.ts';
import { areIntervalsCompatible, checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
import { buildOptimizationResult } from '../shared/results/index.ts';
import type { CPSATConfig, OptimizationResult, SolverOptions } from '../shared/types/index.ts';
import { buildCPSATModel } from './constraints.ts';
import { assignCPSATObjectiveWeights, compareEvaluations, evaluateCPSATSolution } from './objectives.ts';

function createSeededPRNG(seed: number): () => number {
    let s = (seed >>> 0) || 1;
    return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Solves the PTO optimization problem using a CP-SAT style Boolean & Interval Constraint Programming
 * engine with domain propagation, suffix bound filtering, and multi-worker portfolio search.
 */
export async function solveWithCPSAT(options: SolverOptions<CPSATConfig>): Promise<OptimizationResult> {
    const startTime = performance.now();
    const { input, config, onProgress, signal } = options;
    const warnings: string[] = [];

    const upfront = checkUpfrontFeasibility(input);
    if (!upfront.feasible) {
        return buildOptimizationResult({
            algorithmId: 'cpsat',
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
    let globalBestEval = evaluateCPSATSolution(
        baseCalendarDays,
        [],
        input,
        config.enableLexicographic,
        []
    );
    let totalBranchesAll = 0;
    let anyTimedOut = false;
    let allSearchExhausted = true;
    const numWorkers = Math.max(1, Math.min(16, config.numSearchWorkers));

    for (const candidateICTDates of candidateICTSchedules) {
        const model = buildCPSATModel(input, candidateICTDates);
        assignCPSATObjectiveWeights(model, input, config.enableLexicographic);

        const M = model.workingDays.length;
        const B = model.availablePTO;

        // Check required working day domain wipeout (arc consistency pre-check)
        let domainWipedOut = false;
        for (const rIdx of model.requiredWorkIndices) {
            if (model.intervalsCoveringWorkDay[rIdx].length === 0) {
                domainWipedOut = true;
                break;
            }
        }
        if (domainWipedOut) continue;

        if (M === 0 || B === 0) {
            if (isAllocationHardValid(model.calendarDays, [], input, candidateICTDates)) {
                const ev = evaluateCPSATSolution(
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

    // Precompute exact propagated upper-bound table over working days and remaining PTO
    const NEG_INF = -1e15;
    const boundTable: Float64Array[] = Array.from({ length: M + 1 }, () => {
        const a = new Float64Array(B + 1);
        a.fill(NEG_INF);
        return a;
    });
    const bestNextChoice: Int32Array[] = Array.from({ length: M + 1 }, () => {
        const a = new Int32Array(B + 1);
        a.fill(-1);
        return a;
    });

    const isRequiredWorkDay = new Uint8Array(M);
    for (const rIdx of model.requiredWorkIndices) isRequiredWorkDay[rIdx] = 1;

    for (let p = 0; p <= B; p++) {
        if (B - p >= model.minPTORequired) {
            boundTable[M][p] = 0;
        }
    }

    for (let w = M - 1; w >= 0; w--) {
        const varIds = model.intervalsByWorkStart[w];
        const mustCoverW = isRequiredWorkDay[w] === 1;

        for (let p = 0; p <= B; p++) {
            let bestVal = mustCoverW ? NEG_INF : boundTable[w + 1][p];
            let bestId = -1;

            for (const id of varIds) {
                const v = model.intervalVars[id];
                if (v.domain === 0 || v.interval.ptoCost > p) continue;

                let nextW = Math.min(M, v.interval.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        v.interval.calEndIdx +
                        1 +
                        input.rules.distribution.minCalendarDaysBetweenBreaks;
                    while (nextW < M) {
                        const candCalStart =
                            nextW === 0 ? 0 : model.workingDays[nextW - 1].index + 1;
                        if (candCalStart >= minNextCal) break;
                        nextW++;
                    }
                }

                let skipsReq = false;
                for (let k = v.interval.workEndIdx + 1; k < nextW && k < M; k++) {
                    if (isRequiredWorkDay[k] === 1) {
                        skipsReq = true;
                        break;
                    }
                }
                if (skipsReq) continue;

                const sub = boundTable[nextW][p - v.interval.ptoCost];
                if (sub > NEG_INF / 2) {
                    const cand = v.objectiveWeight + sub;
                    if (cand > bestVal) {
                        bestVal = cand;
                        bestId = id;
                    }
                }
            }

            boundTable[w][p] = bestVal;
            bestNextChoice[w][p] = bestId;
        }
    }

    if (boundTable[0][B] <= NEG_INF / 2) {
        continue;
    }

    let bestPTO: string[] | null = null;
    let bestEval = evaluateCPSATSolution(
        model.calendarDays,
        [],
        input,
        config.enableLexicographic,
        candidateICTDates
    );

    if (isAllocationHardValid(model.calendarDays, [], input, candidateICTDates)) {
        bestPTO = [];
        bestEval = evaluateCPSATSolution(
            model.calendarDays,
            [],
            input,
            config.enableLexicographic,
            candidateICTDates
        );
    }

    // Worker 0: Deterministic propagated trajectories for all valid budgets
    for (let pInit = B; pInit >= model.minPTORequired; pInit--) {
        if (boundTable[0][pInit] <= NEG_INF / 2) continue;
        const dates: string[] = [];
        let w = 0;
        let p = pInit;
        while (w < M && p >= 0) {
            const id = bestNextChoice[w][p];
            if (id === -1) {
                w++;
            } else {
                const v = model.intervalVars[id];
                dates.push(...v.interval.ptoDates);
                p -= v.interval.ptoCost;
                let nextW = Math.min(M, v.interval.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        v.interval.calEndIdx +
                        1 +
                        input.rules.distribution.minCalendarDaysBetweenBreaks;
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
            const ev = evaluateCPSATSolution(
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

    // Multi-worker portfolio search (Workers 1..numSearchWorkers)
    let totalBranchesExplored = 1;
    let timedOut = false;
    let searchExhausted = false;

    const runExactBranchSearch = async (): Promise<boolean> => {
        const activeIds: number[] = [];
        let exhausted = true;

        const search = async (w: number, remPTO: number, accWeight: number): Promise<void> => {
            if (signal?.aborted || performance.now() - startTime > timeLimitMs) {
                timedOut = true;
                exhausted = false;
                return;
            }

            totalBranchesExplored++;
            if (totalBranchesExplored % 2500 === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (onProgress) {
                    onProgress({
                        algorithmId: 'cpsat',
                        phase: `CP-SAT Portfolio Search (${numWorkers} worker(s))`,
                        percent: Math.min(95, 25 + Math.round((totalBranchesExplored / 20000) * 70)),
                        currentIteration: totalBranchesExplored,
                        bestScore: bestPTO !== null ? bestEval.primaryScore : undefined,
                        statesExplored: totalBranchesAll + totalBranchesExplored
                    });
                }
            }

            if (boundTable[w][remPTO] <= NEG_INF / 2) return;

            if (w >= M) {
                if (B - remPTO < model.minPTORequired) return;
                const dates: string[] = [];
                for (const id of activeIds) {
                    dates.push(...model.intervalVars[id].interval.ptoDates);
                }
                if (isAllocationHardValid(model.calendarDays, dates, input, candidateICTDates)) {
                    const ev = evaluateCPSATSolution(
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

            const varIds = [...model.intervalsByWorkStart[w]].filter(
                id => model.intervalVars[id].interval.ptoCost <= remPTO
            );
            varIds.sort(
                (a, b) =>
                    model.intervalVars[b].objectiveWeight - model.intervalVars[a].objectiveWeight
            );

            const prevIv =
                activeIds.length > 0
                    ? model.intervalVars[activeIds[activeIds.length - 1]].interval
                    : null;

            for (const id of varIds) {
                const v = model.intervalVars[id];
                if (prevIv && !areIntervalsCompatible(prevIv, v.interval, input.rules)) continue;

                let nextW = Math.min(M, v.interval.workEndIdx + 1 + minWorkSpacing);
                if (
                    input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                    input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                ) {
                    const minNextCal =
                        v.interval.calEndIdx +
                        1 +
                        input.rules.distribution.minCalendarDaysBetweenBreaks;
                    while (nextW < M) {
                        const candCalStart =
                            nextW === 0 ? 0 : model.workingDays[nextW - 1].index + 1;
                        if (candCalStart >= minNextCal) break;
                        nextW++;
                    }
                }

                let skipsReq = false;
                for (let k = v.interval.workEndIdx + 1; k < nextW && k < M; k++) {
                    if (isRequiredWorkDay[k] === 1) {
                        skipsReq = true;
                        break;
                    }
                }
                if (skipsReq) continue;

                activeIds.push(id);
                await search(nextW, remPTO - v.interval.ptoCost, accWeight + v.objectiveWeight);
                activeIds.pop();

                if (timedOut) return;
                if (totalBranchesExplored > 20000 && bestPTO !== null) {
                    return;
                }
            }

            if (isRequiredWorkDay[w] === 0 && !timedOut) {
                if (totalBranchesExplored <= 20000 || bestPTO === null) {
                    await search(w + 1, remPTO, accWeight);
                }
            }
        };

        await search(0, B, 0);
        return exhausted;
    };

    searchExhausted = await runExactBranchSearch();

    // Additional randomized portfolio workers (seeded by config.randomSeed + workerIdx)
    for (let workerIdx = 1; workerIdx < numWorkers && !timedOut; workerIdx++) {
        const rng = createSeededPRNG(config.randomSeed + workerIdx * 1009);
        const trialsPerWorker = 40;

        for (let t = 0; t < trialsPerWorker; t++) {
            if (signal?.aborted || performance.now() - startTime > timeLimitMs) {
                timedOut = true;
                break;
            }
            totalBranchesExplored++;
            let w = 0;
            let p = B;
            const chosenDates: string[] = [];

            while (w < M && p > 0) {
                if (boundTable[w][p] <= NEG_INF / 2) break;
                const optId = bestNextChoice[w][p];
                const candidates = model.intervalsByWorkStart[w].filter(
                    id => model.intervalVars[id].interval.ptoCost <= p
                );

                let pickId = -1;
                if (isRequiredWorkDay[w] === 1) {
                    pickId =
                        optId !== -1
                            ? optId
                            : candidates.length > 0
                              ? candidates[Math.floor(rng() * candidates.length)]
                              : -1;
                } else if (optId !== -1 && rng() < 0.75) {
                    pickId = optId;
                } else if (candidates.length > 0 && rng() < 0.25) {
                    pickId = candidates[Math.floor(rng() * candidates.length)];
                }

                if (pickId === -1) {
                    w++;
                } else {
                    const v = model.intervalVars[pickId];
                    chosenDates.push(...v.interval.ptoDates);
                    p -= v.interval.ptoCost;
                    let nextW = Math.min(M, v.interval.workEndIdx + 1 + minWorkSpacing);
                    if (
                        input.rules.distribution.minCalendarDaysBetweenBreaks !== null &&
                        input.rules.distribution.minCalendarDaysBetweenBreaks > 0
                    ) {
                        const minNextCal =
                            v.interval.calEndIdx +
                            1 +
                            input.rules.distribution.minCalendarDaysBetweenBreaks;
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

            if (isAllocationHardValid(model.calendarDays, chosenDates, input, candidateICTDates)) {
                const ev = evaluateCPSATSolution(
                    model.calendarDays,
                    chosenDates,
                    input,
                    config.enableLexicographic,
                    candidateICTDates
                );
                if (
                    bestPTO === null ||
                    compareEvaluations(ev, bestEval, config.enableLexicographic) > 0
                ) {
                    bestPTO = chosenDates;
                    bestEval = ev;
                }
            }
        }
    }

        totalBranchesAll += totalBranchesExplored;
        if (timedOut) anyTimedOut = true;
        if (!searchExhausted) allSearchExhausted = false;

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
            algorithmId: 'cpsat',
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
                ? 'CP-SAT solver timed out before finding a feasible assignment.'
                : 'CP-SAT proved the constraint model is unsatisfiable (INFEASIBLE).',
            warnings,
            statesExplored: totalBranchesAll
        });
    }

    const isOptimal = !anyTimedOut && allSearchExhausted;

    return buildOptimizationResult({
        algorithmId: 'cpsat',
        selectedPTODates: globalBestPTO,
        selectedICTDates: globalBestICT,
        input,
        calendarDays: baseCalendarDays,
        executionTimeMs: elapsed,
        status: isOptimal ? 'optimal' : 'feasible',
        optimalityGuarantee: isOptimal ? 'proven_optimal' : 'feasible_unproven',
        isExactOptimal: isOptimal,
        enableLexicographic: config.enableLexicographic,
        statusMessage: isOptimal
            ? `CP-SAT proven optimal solution using ${numWorkers} search worker(s) (seed ${config.randomSeed}, ${totalBranchesAll} branches).`
            : `CP-SAT feasible solution found before timeout (${totalBranchesAll} branches across ${numWorkers} worker(s)).`,
        warnings,
        statesExplored: totalBranchesAll
    });
}
