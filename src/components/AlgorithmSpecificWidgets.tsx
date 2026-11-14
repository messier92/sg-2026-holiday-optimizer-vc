import { AlertTriangle, ExternalLink, Info, RotateCcw } from 'lucide-react';
import { useOptimization, type AppRoute } from '@/context/OptimizationContext';
import {
    ALGORITHM_METADATA,
    diffCalendarDays,
    type AlgorithmId,
    type GreedyRankingStrategy
} from '@/core';
import { estimateDPComplexity } from '@/core/dp';

export function SingleAlgorithmConfigCard({
    algorithmId,
    showPageLink = true
}: {
    algorithmId: AlgorithmId;
    showPageLink?: boolean;
}) {
    const {
        sharedInput,
        algorithmConfigs,
        updateAlgorithmConfig,
        resetAlgorithmConfig,
        navigate
    } = useOptimization();

    const meta = ALGORITHM_METADATA[algorithmId];
    const numDays = Math.max(
        0,
        diffCalendarDays(sharedInput.startDate, sharedInput.endDate) + 1
    );

    const dpEstimate =
        algorithmId === 'dp'
            ? estimateDPComplexity(numDays, sharedInput, algorithmConfigs.dp)
            : null;

    return (
        <div className="p-4 rounded-2xl bg-white/60 dark:bg-white/5 border border-white/20 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-indigo-600 dark:text-indigo-400">
                        {meta.name}
                    </span>
                    <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            meta.isExactCapable
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        }`}
                    >
                        {meta.isExactCapable ? 'Exact Capable' : 'Heuristic'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => resetAlgorithmConfig(algorithmId)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-200/70 dark:bg-white/10 hover:bg-neutral-300/70 dark:hover:bg-white/20 transition-colors"
                        title="Reset algorithm parameters to defaults"
                    >
                        <RotateCcw className="w-3 h-3" /> Reset
                    </button>
                    {showPageLink && (
                        <button
                            type="button"
                            onClick={() => navigate(meta.route as AppRoute)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 font-semibold transition-colors"
                        >
                            Dedicated Page <ExternalLink className="w-3 h-3" />
                        </button>
                    )}
                </div>
            </div>

            {/* A. ILP Configuration */}
            {algorithmId === 'ilp' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block font-semibold mb-1">
                                Solver time limit (seconds)
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={120}
                                step={1}
                                value={algorithmConfigs.ilp.timeLimitSeconds}
                                onChange={e =>
                                    updateAlgorithmConfig('ilp', {
                                        timeLimitSeconds: Math.max(1, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">
                                Optimality gap tolerance (0–0.5)
                            </label>
                            <input
                                type="number"
                                min={0}
                                max={0.5}
                                step={0.01}
                                value={algorithmConfigs.ilp.optimalityGapTolerance}
                                onChange={e =>
                                    updateAlgorithmConfig('ilp', {
                                        optimalityGapTolerance: Math.max(
                                            0,
                                            Math.min(0.5, Number(e.target.value))
                                        )
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 cursor-pointer font-medium">
                                <input
                                    type="checkbox"
                                    checked={algorithmConfigs.ilp.enableLexicographic}
                                    onChange={e =>
                                        updateAlgorithmConfig('ilp', {
                                            enableLexicographic: e.target.checked
                                        })
                                    }
                                    className="rounded text-indigo-600"
                                />
                                <span>Enable lexicographic optimization</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-500/10 text-muted-foreground">
                        <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                        <span>
                            A non-zero optimality gap tolerance or solver timeout may return a valid{' '}
                            <strong>feasible solution</strong> without mathematical proof of global optimality.
                        </span>
                    </div>
                </div>
            )}

            {/* B. CP-SAT Configuration */}
            {algorithmId === 'cpsat' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                            <label className="block font-semibold mb-1">
                                Solver time limit (seconds)
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={120}
                                value={algorithmConfigs.cpsat.timeLimitSeconds}
                                onChange={e =>
                                    updateAlgorithmConfig('cpsat', {
                                        timeLimitSeconds: Math.max(1, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">
                                Number of search workers
                            </label>
                            <input
                                type="number"
                                min={1}
                                max={16}
                                value={algorithmConfigs.cpsat.numSearchWorkers}
                                onChange={e =>
                                    updateAlgorithmConfig('cpsat', {
                                        numSearchWorkers: Math.max(
                                            1,
                                            Math.min(16, Number(e.target.value))
                                        )
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Random seed</label>
                            <input
                                type="number"
                                value={algorithmConfigs.cpsat.randomSeed}
                                onChange={e =>
                                    updateAlgorithmConfig('cpsat', {
                                        randomSeed: Number(e.target.value)
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 cursor-pointer font-medium">
                                <input
                                    type="checkbox"
                                    checked={algorithmConfigs.cpsat.enableLexicographic}
                                    onChange={e =>
                                        updateAlgorithmConfig('cpsat', {
                                            enableLexicographic: e.target.checked
                                        })
                                    }
                                    className="rounded text-indigo-600"
                                />
                                <span>Enable lexicographic optimization</span>
                            </label>
                        </div>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-indigo-500/10 text-muted-foreground">
                        <Info className="w-4 h-4 text-indigo-500 shrink-0 mt-0.5" />
                        <span>
                            CP-SAT statuses: <strong>optimal</strong> (proven best),{' '}
                            <strong>feasible</strong> (valid assignment found before limit),{' '}
                            <strong>infeasible</strong> (proven unsatisfiable),{' '}
                            <strong>timeout</strong> (time limit reached without solution),{' '}
                            <strong>unknown</strong> (unclassified).
                        </span>
                    </div>
                </div>
            )}

            {/* C. Dynamic Programming Configuration */}
            {algorithmId === 'dp' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block font-semibold mb-1">
                                Max active state count (per day)
                            </label>
                            <input
                                type="number"
                                min={50}
                                max={500000}
                                step={500}
                                value={algorithmConfigs.dp.maxStateCount}
                                onChange={e =>
                                    updateAlgorithmConfig('dp', {
                                        maxStateCount: Math.max(50, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">
                                State exploration limit (total)
                            </label>
                            <input
                                type="number"
                                min={500}
                                max={2000000}
                                step={5000}
                                value={algorithmConfigs.dp.stateExplorationLimit}
                                onChange={e =>
                                    updateAlgorithmConfig('dp', {
                                        stateExplorationLimit: Math.max(500, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2.5 py-1.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div className="flex items-end pb-1">
                            <label className="flex items-center gap-2 cursor-pointer font-medium">
                                <input
                                    type="checkbox"
                                    checked={algorithmConfigs.dp.enableMemoization}
                                    onChange={e =>
                                        updateAlgorithmConfig('dp', {
                                            enableMemoization: e.target.checked
                                        })
                                    }
                                    className="rounded text-indigo-600"
                                />
                                <span>Enable state memoization</span>
                            </label>
                        </div>
                    </div>

                    {dpEstimate?.warningMessage && (
                        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>{dpEstimate.warningMessage}</span>
                        </div>
                    )}
                </div>
            )}

            {/* D. Greedy Configuration */}
            {algorithmId === 'greedy' && (
                <div className="space-y-3">
                    <div>
                        <label className="block font-semibold mb-1">
                            Candidate-Ranking Strategy
                        </label>
                        <select
                            value={algorithmConfigs.greedy.rankingStrategy}
                            onChange={e =>
                                updateAlgorithmConfig('greedy', {
                                    rankingStrategy: e.target.value as GreedyRankingStrategy
                                })
                            }
                            className="w-full px-3 py-1.5 rounded bg-white dark:bg-zinc-900 border border-neutral-300 dark:border-white/20"
                        >
                            <option value="best_marginal_efficiency">
                                Best marginal improvement per PTO day
                            </option>
                            <option value="max_additional_days_off">
                                Maximum additional calendar days off
                            </option>
                            <option value="max_qualifying_break_duration">
                                Maximum qualifying break duration
                            </option>
                            <option value="max_qualifying_breaks">
                                Maximum number of qualifying breaks
                            </option>
                        </select>
                    </div>
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            <strong>Heuristic Notice:</strong> Greedy commits locally top-ranked PTO
                            candidates step-by-step and is not guaranteed to find a globally optimal
                            solution.
                        </span>
                    </div>
                </div>
            )}

            {/* E. Genetic Algorithm Configuration */}
            {algorithmId === 'genetic' && (
                <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                        <div>
                            <label className="block font-semibold mb-1">Population size</label>
                            <input
                                type="number"
                                min={10}
                                max={500}
                                value={algorithmConfigs.genetic.populationSize}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        populationSize: Math.max(10, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Max generations</label>
                            <input
                                type="number"
                                min={1}
                                max={2000}
                                value={algorithmConfigs.genetic.maxGenerations}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        maxGenerations: Math.max(1, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Mutation rate</label>
                            <input
                                type="number"
                                min={0}
                                max={0.5}
                                step={0.01}
                                value={algorithmConfigs.genetic.mutationRate}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        mutationRate: Math.max(
                                            0,
                                            Math.min(0.5, Number(e.target.value))
                                        )
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Crossover rate</label>
                            <input
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={algorithmConfigs.genetic.crossoverRate}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        crossoverRate: Math.max(
                                            0,
                                            Math.min(1, Number(e.target.value))
                                        )
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Elitism count</label>
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={algorithmConfigs.genetic.elitismCount}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        elitismCount: Math.max(1, Number(e.target.value))
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                        <div>
                            <label className="block font-semibold mb-1">Random seed</label>
                            <input
                                type="number"
                                value={algorithmConfigs.genetic.randomSeed}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        randomSeed: Number(e.target.value)
                                    })
                                }
                                className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center pt-1">
                        <label className="flex items-center gap-2 cursor-pointer font-medium">
                            <input
                                type="checkbox"
                                checked={algorithmConfigs.genetic.enableEarlyStopping}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        enableEarlyStopping: e.target.checked
                                    })
                                }
                                className="rounded text-indigo-600"
                            />
                            <span>Enable early stopping</span>
                        </label>

                        <div className="flex items-center gap-2">
                            <span className="text-muted-foreground whitespace-nowrap">
                                Stagnant gens:
                            </span>
                            <input
                                type="number"
                                min={5}
                                max={500}
                                disabled={!algorithmConfigs.genetic.enableEarlyStopping}
                                value={algorithmConfigs.genetic.earlyStoppingGenerations}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        earlyStoppingGenerations: Math.max(
                                            5,
                                            Number(e.target.value)
                                        )
                                    })
                                }
                                className="w-20 px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                            />
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer font-medium">
                            <input
                                type="checkbox"
                                checked={algorithmConfigs.genetic.showConvergenceProgress}
                                onChange={e =>
                                    updateAlgorithmConfig('genetic', {
                                        showConvergenceProgress: e.target.checked
                                    })
                                }
                                className="rounded text-indigo-600"
                            />
                            <span>Show convergence progress</span>
                        </label>
                    </div>

                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300">
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>
                            <strong>Heuristic Notice:</strong> Genetic Algorithm results are
                            evolutionary heuristic approximations (reproducible via Random Seed) and do
                            not prove global optimality.
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function SelectedAlgorithmsConfigSection() {
    const { selectedAlgorithmIds } = useOptimization();

    if (selectedAlgorithmIds.length === 0) {
        return null;
    }

    return (
        <div className="mt-6 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Algorithm-Specific Parameters ({selectedAlgorithmIds.length} selected)
            </h4>
            <div className="grid grid-cols-1 gap-4">
                {selectedAlgorithmIds.map(id => (
                    <SingleAlgorithmConfigCard key={id} algorithmId={id} showPageLink={true} />
                ))}
            </div>
        </div>
    );
}
