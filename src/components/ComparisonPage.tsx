import { useState } from 'react';
import {
    AlertTriangle,
    ArrowLeft,
    ExternalLink,
    Loader2,
    Play,
    Trophy
} from 'lucide-react';
import { useOptimization, type AppRoute } from '@/context/OptimizationContext';
import {
    ALGORITHM_METADATA,
    type AlgorithmId,
    type OptimizationResult
} from '@/core';
import { SingaporeCalendarGrid } from './Calendar';

export function ComparisonPage() {
    const {
        startDate,
        endDate,
        duration,
        rules,
        selectedAlgorithmIds,
        results,
        isRunning,
        runSelectedAlgorithms,
        isResultStale,
        hasAnyStaleResults,
        navigate
    } = useOptimization();

    const [calendarInspectAlgo, setCalendarInspectAlgo] = useState<AlgorithmId | null>(null);

    const availablePTO = Math.max(0, duration - rules.allocation.reservePTODays);

    // Filter valid, non-stale results among selected algorithms and rank by configured Primary Objective
    const validRankedResults: OptimizationResult[] = selectedAlgorithmIds
        .map(id => (!isResultStale(id) ? results[id] : undefined))
        .filter(
            (r): r is OptimizationResult =>
                !!r && r.validation.isValid && (r.status === 'optimal' || r.status === 'feasible')
        )
        .sort((a, b) => {
            if (Math.abs(b.primaryObjectiveScore - a.primaryObjectiveScore) > 1e-6) {
                return b.primaryObjectiveScore - a.primaryObjectiveScore;
            }
            return b.secondaryObjectiveScore - a.secondaryObjectiveScore;
        });

    const bestResult = validRankedResults.length > 0 ? validRankedResults[0] : null;
    const activeCalAlgo =
        calendarInspectAlgo && selectedAlgorithmIds.includes(calendarInspectAlgo)
            ? calendarInspectAlgo
            : bestResult?.algorithmId ?? selectedAlgorithmIds[0] ?? null;
    const activeCalResult =
        activeCalAlgo && !isResultStale(activeCalAlgo) ? results[activeCalAlgo] : undefined;

    return (
        <div className="pt-24 pb-20 container mx-auto px-6 space-y-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-semibold bg-white/60 dark:bg-white/5 border border-white/20 hover:bg-indigo-500/10 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Main Calendar & Controls
                </button>

                <button
                    type="button"
                    disabled={selectedAlgorithmIds.length === 0 || isRunning}
                    onClick={() => void runSelectedAlgorithms()}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 disabled:opacity-50"
                >
                    {isRunning ? (
                        <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Running All Selected ({selectedAlgorithmIds.length})...
                        </>
                    ) : (
                        <>
                            <Play className="w-4 h-4" />
                            Run All Selected Algorithms ({selectedAlgorithmIds.length})
                        </>
                    )}
                </button>
            </div>

            <div className="p-6 md:p-8 rounded-3xl bg-white/60 dark:bg-white/5 border border-white/20 backdrop-blur-sm space-y-4">
                <h1 className="text-2xl md:text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
                    Multi-Algorithm Comparison
                </h1>
                <p className="text-xs md:text-sm text-muted-foreground">
                    Comparing <strong>{selectedAlgorithmIds.length}</strong> selected algorithm(s) on
                    identical shared inputs: Range <strong>{startDate}</strong> to{' '}
                    <strong>{endDate}</strong> • PTO Allowance: <strong>{duration} days</strong> ({availablePTO}{' '}
                    available) • Primary Objective:{' '}
                    <strong className="text-indigo-600 dark:text-indigo-400">
                        {rules.objectives.primary.replace(/_/g, ' ')}
                    </strong>
                </p>

                {hasAnyStaleResults && (
                    <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>
                            Shared configuration changed since one or more algorithms were executed.
                            Stale results are hidden to prevent invalid comparisons — click &ldquo;Run All Selected Algorithms&rdquo; above.
                        </span>
                    </div>
                )}

                {bestResult && (
                    <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-emerald-500 text-white">
                                <Trophy className="w-5 h-5" />
                            </div>
                            <div>
                                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                    Best Result for Configured Primary Objective (
                                    {rules.objectives.primary.replace(/_/g, ' ')})
                                </div>
                                <div className="text-base font-extrabold">
                                    {bestResult.algorithmName} — Primary Score:{' '}
                                    {bestResult.primaryObjectiveScore.toFixed(2)} (
                                    {bestResult.totalCalendarDaysOff} calendar days off,{' '}
                                    {bestResult.totalPTOConsumed} PTO used)
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() =>
                                navigate(
                                    ALGORITHM_METADATA[bestResult.algorithmId].route as AppRoute
                                )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500"
                        >
                            Open {ALGORITHM_METADATA[bestResult.algorithmId].shortName} Page{' '}
                            <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>

            {selectedAlgorithmIds.length === 0 ? (
                <div className="p-8 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/20 text-center space-y-3">
                    <p className="text-sm font-semibold">No algorithms are currently selected.</p>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold"
                    >
                        Select Algorithms on Main Widget
                    </button>
                </div>
            ) : (
                <>
                    {/* Comparison Table (Only Selected Algorithms) */}
                    <div className="p-6 rounded-3xl bg-white/60 dark:bg-white/5 border border-white/20 overflow-x-auto">
                        <h2 className="text-lg font-bold mb-4">
                            Side-by-Side Metric Comparison (Selected Algorithms Only)
                        </h2>
                        <table className="w-full text-left border-collapse text-xs md:text-sm">
                            <thead>
                                <tr className="border-b border-white/20">
                                    <th className="py-3 px-4 font-bold text-muted-foreground">
                                        Metric
                                    </th>
                                    {selectedAlgorithmIds.map(id => {
                                        const meta = ALGORITHM_METADATA[id];
                                        const isWinner = bestResult?.algorithmId === id;
                                        return (
                                            <th
                                                key={id}
                                                className={`py-3 px-4 font-bold ${
                                                    isWinner
                                                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/5'
                                                        : ''
                                                }`}
                                            >
                                                <div className="flex items-center gap-1.5">
                                                    <span>{meta.shortName}</span>
                                                    {isWinner && (
                                                        <Trophy className="w-3.5 h-3.5 text-emerald-500" />
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-normal text-muted-foreground block">
                                                    {meta.isExactCapable
                                                        ? 'Exact Solver'
                                                        : 'Heuristic'}
                                                </span>
                                            </th>
                                        );
                                    })}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10">
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">
                                        Primary Objective Score (
                                        {rules.objectives.primary.replace(/_/g, ' ')})
                                    </td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td
                                                key={id}
                                                className="py-2.5 px-4 font-bold text-indigo-600 dark:text-indigo-400"
                                            >
                                                {r ? r.primaryObjectiveScore.toFixed(2) : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Total days off</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4 font-semibold">
                                                {r
                                                    ? `${r.totalCalendarDaysOff} days (${r.totalNonWorkingCalendarDays} total non-working)`
                                                    : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">PTO consumed</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                {r
                                                    ? `${r.totalPTOConsumed} / ${r.availablePTOAllowance} (${r.remainingPTOAllowance} rem)`
                                                    : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Number of breaks</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                {r
                                                    ? `${r.numberOfQualifyingBreaks} qualifying (${r.breaks.length} total)`
                                                    : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Extended breaks</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                {r ? r.categoryCounts.extended : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">
                                        Break distribution (S / M / L / E)
                                    </td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4 text-xs">
                                                {r
                                                    ? `S:${r.categoryCounts.short} • M:${r.categoryCounts.medium} • L:${r.categoryCounts.long} • E:${r.categoryCounts.extended}`
                                                    : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">PTO efficiency</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4 font-semibold">
                                                {r ? `${r.ptoEfficiency.toFixed(2)}x` : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Execution time</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                {r ? `${r.executionTimeMs.toFixed(2)} ms` : '—'}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Optimality status</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const r = !isResultStale(id) ? results[id] : undefined;
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                {r ? (
                                                    <span
                                                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                                                            r.isExactOptimal
                                                                ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                                                                : r.optimalityGuarantee ===
                                                                    'heuristic'
                                                                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                                                  : r.status === 'infeasible'
                                                                    ? 'bg-red-500/20 text-red-700 dark:text-red-300'
                                                                    : 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                                                        }`}
                                                    >
                                                        {r.status.toUpperCase()} •{' '}
                                                        {r.isExactOptimal
                                                            ? 'Proven Optimal'
                                                            : r.optimalityGuarantee === 'heuristic'
                                                              ? 'Heuristic'
                                                              : 'Feasible'}
                                                    </span>
                                                ) : (
                                                    'Not executed'
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                                <tr>
                                    <td className="py-2.5 px-4 font-semibold">Actions</td>
                                    {selectedAlgorithmIds.map(id => {
                                        const meta = ALGORITHM_METADATA[id];
                                        return (
                                            <td key={id} className="py-2.5 px-4">
                                                <div className="flex flex-wrap gap-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            navigate(meta.route as AppRoute)
                                                        }
                                                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25 text-xs font-semibold"
                                                    >
                                                        Details <ExternalLink className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setCalendarInspectAlgo(id)}
                                                        className="px-2.5 py-1 rounded bg-purple-500/15 text-purple-600 dark:text-purple-300 hover:bg-purple-500/25 text-xs font-semibold"
                                                    >
                                                        Inspect Calendar
                                                    </button>
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    {/* Interactive Calendar Comparison */}
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-xl font-bold">
                                Calendar Comparison View{' '}
                                {activeCalAlgo
                                    ? `— ${ALGORITHM_METADATA[activeCalAlgo].name}`
                                    : ''}
                            </h2>
                            <div className="flex flex-wrap gap-2">
                                {selectedAlgorithmIds.map(id => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setCalendarInspectAlgo(id)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                            activeCalAlgo === id
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white/50 dark:bg-white/5 border-white/20 hover:bg-indigo-500/10'
                                        }`}
                                    >
                                        {ALGORITHM_METADATA[id].shortName}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <SingaporeCalendarGrid
                            year={2027}
                            startDate={startDate}
                            endDate={endDate}
                            ptoDates={activeCalResult?.selectedPTODates ?? []}
                            continuousBreakDates={
                                new Set(activeCalResult?.continuousBreakDates ?? [])
                            }
                        />
                    </div>
                </>
            )}
        </div>
    );
}
