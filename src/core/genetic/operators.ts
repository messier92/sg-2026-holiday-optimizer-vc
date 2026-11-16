import { evaluateChromosomeFitness } from './fitness.ts';
import type { Chromosome, GARunContext, SeededRNG } from './types.ts';

/**
 * Repairs a chromosome in-place so that it satisfies:
 * 1. Blackout, prohibited range, and adjacency restrictions.
 * 2. Mandatory required PTO dates.
 * 3. Maximum consecutive PTO working days.
 * 4. Minimum working days and calendar days between PTO breaks.
 * 5. Available PTO allowance and minimum PTO allocation.
 */
export function repairChromosomeGenes(
    genes: Uint8Array,
    ctx: GARunContext,
    rng: SeededRNG
): Uint8Array {
    const M = genes.length;
    if (M === 0) return genes;

    const { rules } = ctx.input;
    const maxConsec = rules.allocation.maxConsecutivePTOWorkingDays;
    const minWorkSpacing = Math.max(1, rules.distribution.minWorkingDaysBetweenBreaks);
    const minCalSpacing = rules.distribution.minCalendarDaysBetweenBreaks ?? 0;

    // 1. Enforce allowed mask and required mask
    for (let i = 0; i < M; i++) {
        if (ctx.allowedMask[i] === 0) {
            genes[i] = 0;
        } else if (ctx.requiredMask[i] === 1) {
            genes[i] = 1;
        }
    }

    const hasICFGap = (idxA: number, idxB: number): boolean => {
        if (ctx.selectedICTSet.size === 0 || idxA < 0 || idxB >= M) return false;
        for (let c = ctx.workingDays[idxA].index + 1; c < ctx.workingDays[idxB].index; c++) {
            if (ctx.selectedICTSet.has(ctx.calendarDays[c].date)) return true;
        }
        return false;
    };

    // 2. Enforce maxConsecutivePTOWorkingDays
    if (maxConsec !== null && maxConsec > 0) {
        let run = 0;
        for (let i = 0; i < M; i++) {
            if (i > 0 && hasICFGap(i - 1, i)) {
                run = 0;
            }
            if (genes[i] === 1) {
                run++;
                if (run > maxConsec && ctx.requiredMask[i] === 0) {
                    genes[i] = 0;
                    run = 0;
                }
            } else {
                run = 0;
            }
        }
    } else if (maxConsec !== null && maxConsec <= 0) {
        for (let i = 0; i < M; i++) {
            if (ctx.requiredMask[i] === 0) genes[i] = 0;
        }
    }

    // 3. Enforce break spacing between contiguous runs of working-day PTO
    // Identify contiguous [a, b] runs of genes[i] === 1
    let lastEndWorkIdx = -100000;
    let lastEndCalIdx = -100000;

    let i = 0;
    while (i < M) {
        if (genes[i] === 0) {
            i++;
            continue;
        }
        const a = i;
        let hasRequired = false;
        while (i < M && genes[i] === 1) {
            if (ctx.requiredMask[i] === 1) hasRequired = true;
            i++;
        }
        const b = i - 1;
        const calStartIdx = a === 0 ? 0 : ctx.workingDays[a - 1].index + 1;
        const calEndIdx =
            b === M - 1 ? ctx.calendarDays.length - 1 : ctx.workingDays[b + 1].index - 1;

        const workGap = a - lastEndWorkIdx - 1;
        const calGap = calStartIdx - lastEndCalIdx - 1;

        if (workGap < minWorkSpacing || (minCalSpacing > 0 && calGap < minCalSpacing)) {
            if (!hasRequired) {
                // Clear this cluster
                for (let k = a; k <= b; k++) genes[k] = 0;
            } else {
                // Keep required cluster and clear previous if needed
                lastEndWorkIdx = b;
                lastEndCalIdx = calEndIdx;
            }
        } else {
            lastEndWorkIdx = b;
            lastEndCalIdx = calEndIdx;
        }
    }

    // 4. Trim excess PTO above availablePTO
    let count = 0;
    for (let k = 0; k < M; k++) {
        if (genes[k] === 1) count++;
    }

    if (count > ctx.availablePTO) {
        // Collect removable indices (prefer removing isolated non-required PTO days or tail of clusters)
        const removable: number[] = [];
        for (let k = 0; k < M; k++) {
            if (genes[k] === 1 && ctx.requiredMask[k] === 0) {
                removable.push(k);
            }
        }
        // Shuffle removable deterministically
        for (let k = removable.length - 1; k > 0; k--) {
            const j = Math.floor(rng() * (k + 1));
            const tmp = removable[k];
            removable[k] = removable[j];
            removable[j] = tmp;
        }
        let idx = 0;
        while (count > ctx.availablePTO && idx < removable.length) {
            const pos = removable[idx++];
            // Avoid splitting a cluster into two adjacent clusters that violate spacing!
            const leftIsOne = pos > 0 && genes[pos - 1] === 1;
            const rightIsOne = pos < M - 1 && genes[pos + 1] === 1;
            if (leftIsOne && rightIsOne && minWorkSpacing > 1) {
                continue;
            }
            genes[pos] = 0;
            count--;
        }
        // If still over budget (because only interior points were left), clear whole clusters from end
        for (let k = M - 1; k >= 0 && count > ctx.availablePTO; k--) {
            if (genes[k] === 1 && ctx.requiredMask[k] === 0) {
                genes[k] = 0;
                count--;
            }
        }
    }

    // 5. Fill PTO up to target budget (or minPTORequired) using cluster extension & multi-day packing
    // so that 14-working-day spacing never deadlocks the chromosome at ~6 isolated 1-day breaks.
    const targetFillPTO = !rules.allocation.allowUnusedPTO
        ? ctx.availablePTO
        : rules.objectives.primary === 'minimize_pto_consumption'
          ? ctx.minPTORequired
          : ctx.availablePTO;

    if (count < targetFillPTO) {
        const canAddAt = (pos: number): boolean => {
            if (pos < 0 || pos >= M) return false;
            if (genes[pos] === 1 || ctx.allowedMask[pos] === 0) return false;
            genes[pos] = 1;

            // Check consecutive limit
            if (maxConsec !== null) {
                let r = 0;
                const lo = Math.max(0, pos - maxConsec - 1);
                const hi = Math.min(M - 1, pos + maxConsec + 1);
                for (let k = lo; k <= hi; k++) {
                    if (k > lo && hasICFGap(k - 1, k)) {
                        r = 0;
                    }
                    if (genes[k] === 1) {
                        r++;
                        if (r > maxConsec) {
                            genes[pos] = 0;
                            return false;
                        }
                    } else {
                        r = 0;
                    }
                }
            }

            // Check spacing across all clusters
            let prevEndW = -100000;
            let prevEndCal = -100000;
            let idx = 0;
            while (idx < M) {
                if (genes[idx] === 0) {
                    idx++;
                    continue;
                }
                const a = idx;
                while (idx < M && genes[idx] === 1) idx++;
                const b = idx - 1;
                const cStart = a === 0 ? 0 : ctx.workingDays[a - 1].index + 1;
                const cEnd =
                    b === M - 1 ? ctx.calendarDays.length - 1 : ctx.workingDays[b + 1].index - 1;
                if (
                    a - prevEndW - 1 < minWorkSpacing ||
                    (minCalSpacing > 0 && cStart - prevEndCal - 1 < minCalSpacing)
                ) {
                    genes[pos] = 0;
                    return false;
                }
                prevEndW = b;
                prevEndCal = cEnd;
            }

            return true;
        };

        const extendExistingClusters = (target: number) => {
            let extended = true;
            while (extended && count < target) {
                extended = false;
                let idx = 0;
                while (idx < M && count < target) {
                    if (genes[idx] === 0) {
                        idx++;
                        continue;
                    }
                    const a = idx;
                    while (idx < M && genes[idx] === 1) idx++;
                    const b = idx - 1;

                    if (b + 1 < M && count < target && canAddAt(b + 1)) {
                        count++;
                        extended = true;
                    }
                    if (a - 1 >= 0 && count < target && canAddAt(a - 1)) {
                        count++;
                        extended = true;
                    }
                }
            }
        };

        const addAndGrowClusters = (order: number[], target: number, maxClusterSize: number) => {
            for (const pos of order) {
                if (count >= target) break;
                if (canAddAt(pos)) {
                    count++;
                    let addedInCluster = 1;
                    // Immediately grow this new cluster forward and backward so a single break
                    // can absorb multiple PTO days without consuming extra break-spacing slots
                    for (
                        let f = pos + 1;
                        f < M && count < target && addedInCluster < maxClusterSize;
                        f++
                    ) {
                        if (canAddAt(f)) {
                            count++;
                            addedInCluster++;
                        } else {
                            break;
                        }
                    }
                    for (
                        let b = pos - 1;
                        b >= 0 && count < target && addedInCluster < maxClusterSize;
                        b--
                    ) {
                        if (canAddAt(b)) {
                            count++;
                            addedInCluster++;
                        } else {
                            break;
                        }
                    }
                }
            }
        };

        // Build a candidate order that prioritizes holiday/weekend bridges first, then rotated working days
        const offset = Math.floor(rng() * M);
        const order: number[] = [...ctx.bridgePriorityIndices];
        for (let k = 0; k < M; k++) {
            order.push((k + offset) % M);
        }

        const preferredClusterCap = Math.min(maxConsec ?? 5, 5);

        // Phase A: Extend existing clusters first (avoids creating new spacing locks)
        extendExistingClusters(targetFillPTO);

        // Phase B: Add new multi-day clusters in valid gaps and extend
        if (count < targetFillPTO) {
            addAndGrowClusters(order, targetFillPTO, preferredClusterCap);
            extendExistingClusters(targetFillPTO);
        }

        // Phase C: If still below targetFillPTO (e.g., scattered 1-day breaks deadlocked spacing),
        // consolidate by rebuilding non-required genes as multi-day clusters
        if (count < targetFillPTO) {
            for (let k = 0; k < M; k++) {
                if (ctx.requiredMask[k] === 0) {
                    genes[k] = 0;
                }
            }
            count = 0;
            for (let k = 0; k < M; k++) {
                if (genes[k] === 1) count++;
            }

            const rebuildCap = Math.min(maxConsec ?? 10, Math.max(5, Math.ceil(targetFillPTO / 2)));
            extendExistingClusters(targetFillPTO);
            addAndGrowClusters(order, targetFillPTO, rebuildCap);
            extendExistingClusters(targetFillPTO);
        }
    }

    return genes;
}

/**
 * Generates the initial population of chromosomes using a mix of bridge-focused,
 * cluster-focused, and random individuals.
 */
export function initializePopulation(
    popSize: number,
    ctx: GARunContext,
    rng: SeededRNG
): Chromosome[] {
    const M = ctx.workingDays.length;
    const population: Chromosome[] = [];
    const minWorkSpacing = Math.max(1, ctx.input.rules.distribution.minWorkingDaysBetweenBreaks);
    const maxConsec = ctx.input.rules.allocation.maxConsecutivePTOWorkingDays ?? 5;

    for (let p = 0; p < popSize; p++) {
        const genes = new Uint8Array(M);
        for (let i = 0; i < M; i++) {
            if (ctx.requiredMask[i] === 1) genes[i] = 1;
        }

        if (M > 0 && ctx.availablePTO > 0) {
            const targetBudget =
                ctx.input.rules.objectives.primary === 'minimize_pto_consumption'
                    ? Math.max(ctx.minPTORequired, (p % ctx.availablePTO) + 1)
                    : ctx.input.rules.allocation.allowUnusedPTO && p % 5 === 0
                      ? Math.max(
                            ctx.minPTORequired,
                            Math.floor(rng() * (ctx.availablePTO + 1))
                        )
                      : ctx.availablePTO;

            let used = 0;
            for (let i = 0; i < M; i++) if (genes[i] === 1) used++;

            let attempts = 0;
            while (used < targetBudget && attempts < 40) {
                attempts++;
                // Pick a start index: 65% from holiday/weekend bridges, 35% uniform
                let startIdx = 0;
                if (ctx.bridgePriorityIndices.length > 0 && rng() < 0.65) {
                    startIdx =
                        ctx.bridgePriorityIndices[
                            Math.floor(rng() * ctx.bridgePriorityIndices.length)
                        ];
                } else {
                    startIdx = Math.floor(rng() * M);
                }

                // Choose cluster length (1 to min(remaining, maxConsec, 5))
                const maxCluster = Math.min(targetBudget - used, maxConsec, p % 3 === 0 ? 1 : 4);
                const len = Math.max(1, Math.floor(rng() * maxCluster) + 1);

                for (let k = 0; k < len && startIdx + k < M && used < targetBudget; k++) {
                    const idx = startIdx + k;
                    if (ctx.allowedMask[idx] === 1 && genes[idx] === 0) {
                        genes[idx] = 1;
                        used++;
                    }
                }
                startIdx += len + minWorkSpacing;
            }
        }

        repairChromosomeGenes(genes, ctx, rng);
        population.push(evaluateChromosomeFitness(genes, ctx));
    }

    return population;
}

export function tournamentSelect(
    population: Chromosome[],
    rng: SeededRNG,
    tournamentSize = 3
): Chromosome {
    let best = population[Math.floor(rng() * population.length)];
    for (let i = 1; i < tournamentSize; i++) {
        const contender = population[Math.floor(rng() * population.length)];
        if (contender.fitness > best.fitness) {
            best = contender;
        }
    }
    return best;
}

export function crossoverChromosomes(
    parentA: Chromosome,
    parentB: Chromosome,
    crossoverRate: number,
    rng: SeededRNG
): [Uint8Array, Uint8Array] {
    const M = parentA.genes.length;
    const child1 = new Uint8Array(parentA.genes);
    const child2 = new Uint8Array(parentB.genes);

    if (M <= 1 || rng() >= crossoverRate) {
        return [child1, child2];
    }

    let pt1 = Math.floor(rng() * M);
    let pt2 = Math.floor(rng() * M);
    if (pt1 > pt2) {
        const tmp = pt1;
        pt1 = pt2;
        pt2 = tmp;
    }

    for (let i = pt1; i <= pt2; i++) {
        child1[i] = parentB.genes[i];
        child2[i] = parentA.genes[i];
    }

    return [child1, child2];
}

export function mutateChromosomeGenes(
    genes: Uint8Array,
    mutationRate: number,
    ctx: GARunContext,
    rng: SeededRNG
): void {
    const M = genes.length;
    if (M === 0 || mutationRate <= 0) return;

    // 1. Cluster/window shift mutation
    if (rng() < Math.min(0.6, mutationRate * 6)) {
        // Turn off one non-required cluster and turn on a new cluster at a bridge or random working day
        const activeIndices: number[] = [];
        for (let i = 0; i < M; i++) {
            if (genes[i] === 1 && ctx.requiredMask[i] === 0) {
                activeIndices.push(i);
            }
        }
        if (activeIndices.length > 0) {
            const dropIdx = activeIndices[Math.floor(rng() * activeIndices.length)];
            genes[dropIdx] = 0;
        }

        let addIdx = Math.floor(rng() * M);
        if (ctx.bridgePriorityIndices.length > 0 && rng() < 0.7) {
            addIdx =
                ctx.bridgePriorityIndices[
                    Math.floor(rng() * ctx.bridgePriorityIndices.length)
                ];
        }
        if (ctx.allowedMask[addIdx] === 1) {
            genes[addIdx] = 1;
        }
    }

    // 2. Gene-level bit flip with probability scaled so expected flips per chromosome is reasonable
    const perGeneProb = Math.min(0.15, (mutationRate * 3) / Math.max(1, M));
    for (let i = 0; i < M; i++) {
        if (ctx.allowedMask[i] === 0 || ctx.requiredMask[i] === 1) continue;
        if (rng() < perGeneProb) {
            genes[i] = genes[i] === 1 ? 0 : 1;
        }
    }
}
