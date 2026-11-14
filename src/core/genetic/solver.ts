import { checkUpfrontFeasibility, isAllocationHardValid } from '../shared/constraints/index.ts';
import { buildOptimizationResult } from '../shared/results/index.ts';
import type {
    ConvergencePoint,
    GeneticConfig,
    OptimizationResult,
    SolverOptions
} from '../shared/types/index.ts';
import {
    chromosomeToDates,
    cloneChromosome,
    createGARunContext,
    createSeededRNG
} from './chromosome.ts';
import { evaluateChromosomeFitness } from './fitness.ts';
import {
    crossoverChromosomes,
    initializePopulation,
    mutateChromosomeGenes,
    repairChromosomeGenes,
    tournamentSelect
} from './operators.ts';

/**
 * Solves the PTO optimization problem using a reproducible Genetic Algorithm (GA)
 * with tournament selection, two-point crossover, cluster-aware mutation, elitism,
 * and deterministic constraint repair.
 */
export async function solveWithGenetic(options: SolverOptions<GeneticConfig>): Promise<OptimizationResult> {
    const startTime = performance.now();
    const { input, config, onProgress, signal } = options;
    const warnings: string[] = [
        `Genetic Algorithm (population ${config.populationSize}, max ${config.maxGenerations} generations, seed ${config.randomSeed}) is a stochastic metaheuristic and does not guarantee global optimality.`
    ];

    const upfront = checkUpfrontFeasibility(input);
    if (!upfront.feasible) {
        return buildOptimizationResult({
            algorithmId: 'genetic',
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

    const ctx = createGARunContext(input);
    const M = ctx.workingDays.length;

    if (M === 0 || ctx.availablePTO === 0) {
        const zeroValid = isAllocationHardValid(ctx.calendarDays, [], input);
        return buildOptimizationResult({
            algorithmId: 'genetic',
            selectedPTODates: [],
            input,
            calendarDays: ctx.calendarDays,
            executionTimeMs: performance.now() - startTime,
            status: zeroValid ? 'feasible' : 'infeasible',
            optimalityGuarantee: zeroValid ? 'heuristic' : 'infeasible',
            isExactOptimal: false,
            statusMessage: zeroValid
                ? 'Heuristic solution with 0 PTO days allocated.'
                : 'Infeasible: constraints cannot be satisfied with 0 PTO.',
            warnings
        });
    }

    const rng = createSeededRNG(config.randomSeed);
    const popSize = Math.max(10, Math.min(500, config.populationSize));
    const maxGens = Math.max(1, Math.min(2000, config.maxGenerations));
    const elitism = Math.max(1, Math.min(popSize - 1, config.elitismCount));

    let population = initializePopulation(popSize, ctx, rng);
    population.sort((a, b) => b.fitness - a.fitness);

    let bestIndividual = cloneChromosome(population[0]);
    let gensWithoutImprovement = 0;
    const convergenceHistory: ConvergencePoint[] = [];

    const recordGeneration = (gen: number) => {
        const validPop = population.filter(c => c.isValid);
        const pool = validPop.length > 0 ? validPop : population;
        const bestScore = pool[0].primaryScore;
        const avgScore =
            pool.reduce((s, c) => s + c.primaryScore, 0) / Math.max(1, pool.length);
        convergenceHistory.push({
            generation: gen,
            bestFitness: Number(bestScore.toFixed(2)),
            averageFitness: Number(avgScore.toFixed(2))
        });
    };

    recordGeneration(0);

    let completedGen = 0;
    for (let gen = 1; gen <= maxGens; gen++) {
        if (signal?.aborted) {
            return buildOptimizationResult({
                algorithmId: 'genetic',
                selectedPTODates: [],
                input,
                calendarDays: ctx.calendarDays,
                executionTimeMs: performance.now() - startTime,
                status: 'timeout',
                optimalityGuarantee: 'none',
                isExactOptimal: false,
                statusMessage: 'Genetic Algorithm execution was cancelled.',
                warnings,
                convergenceHistory
            });
        }

        const nextPopulation = population.slice(0, elitism).map(cloneChromosome);

        while (nextPopulation.length < popSize) {
            const parentA = tournamentSelect(population, rng);
            const parentB = tournamentSelect(population, rng);

            const [child1Genes, child2Genes] = crossoverChromosomes(
                parentA,
                parentB,
                config.crossoverRate,
                rng
            );

            mutateChromosomeGenes(child1Genes, config.mutationRate, ctx, rng);
            repairChromosomeGenes(child1Genes, ctx, rng);
            nextPopulation.push(evaluateChromosomeFitness(child1Genes, ctx));

            if (nextPopulation.length < popSize) {
                mutateChromosomeGenes(child2Genes, config.mutationRate, ctx, rng);
                repairChromosomeGenes(child2Genes, ctx, rng);
                nextPopulation.push(evaluateChromosomeFitness(child2Genes, ctx));
            }
        }

        nextPopulation.sort((a, b) => b.fitness - a.fitness);
        population = nextPopulation;
        completedGen = gen;

        if (population[0].fitness > bestIndividual.fitness + 1e-6) {
            bestIndividual = cloneChromosome(population[0]);
            gensWithoutImprovement = 0;
        } else {
            gensWithoutImprovement++;
        }

        if (config.showConvergenceProgress || gen === maxGens || gen % 5 === 0) {
            recordGeneration(gen);
        }

        if (gen % 25 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (onProgress) {
                onProgress({
                    algorithmId: 'genetic',
                    phase: `Evolving Generation ${gen} / ${maxGens}`,
                    percent: Math.min(98, Math.round((gen / maxGens) * 95)),
                    currentIteration: gen,
                    maxIterations: maxGens,
                    bestScore: bestIndividual.primaryScore,
                    convergenceHistory: [...convergenceHistory]
                });
            }
        }

        if (
            config.enableEarlyStopping &&
            gensWithoutImprovement >= Math.max(5, config.earlyStoppingGenerations)
        ) {
            recordGeneration(gen);
            break;
        }
    }

    const elapsed = performance.now() - startTime;
    const validCandidates = population.filter(c => c.isValid);
    const chosen = bestIndividual.isValid
        ? bestIndividual
        : validCandidates.length > 0
          ? validCandidates[0]
          : null;

    if (!chosen) {
        return buildOptimizationResult({
            algorithmId: 'genetic',
            selectedPTODates: [],
            input,
            calendarDays: ctx.calendarDays,
            executionTimeMs: elapsed,
            status: 'infeasible',
            optimalityGuarantee: 'infeasible',
            isExactOptimal: false,
            statusMessage: `Genetic Algorithm completed ${completedGen} generation(s) without finding a chromosome satisfying all hard constraints.`,
            warnings,
            convergenceHistory,
            statesExplored: completedGen * popSize
        });
    }

    const selectedDates = chromosomeToDates(chosen.genes, ctx);

    return buildOptimizationResult({
        algorithmId: 'genetic',
        selectedPTODates: selectedDates,
        input,
        calendarDays: ctx.calendarDays,
        executionTimeMs: elapsed,
        status: 'feasible',
        optimalityGuarantee: 'heuristic',
        isExactOptimal: false,
        statusMessage: `Genetic Algorithm heuristic solution converged after ${completedGen} generation(s) (pop=${popSize}, seed=${config.randomSeed}, best primary score=${chosen.primaryScore.toFixed(2)}).`,
        warnings,
        convergenceHistory,
        statesExplored: completedGen * popSize
    });
}
