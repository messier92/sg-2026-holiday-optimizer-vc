import { useMemo } from 'react';
import {
    ArrowLeft,
    BarChart3,
    Calendar as CalendarIcon,
    Loader2,
    Play,
    Shield,
    XCircle
} from 'lucide-react';
import { useOptimization, type AppRoute } from '@/context/OptimizationContext';
import { ALGORITHM_METADATA, type AlgorithmId } from '@/core';
import { SingleAlgorithmConfigCard } from './AlgorithmSpecificWidgets';
import { SingaporeCalendarGrid } from './Calendar';
import { ResultSummaryPanel } from './ResultSummaryPanel';

export function AlgorithmPage({ algorithmId }: { algorithmId: AlgorithmId }) {
    const {
        startDate,
        endDate,
        duration,
        rules,
        selectedAlgorithms,
        setAlgorithmSelected,
        selectedAlgorithmIds,
        results,
        progressMap,
        runningAlgorithms,
        runSingleAlgorithm,
        cancelOptimization,
        isResultStale,
        navigate
    } = useOptimization();

    const meta = ALGORITHM_METADATA[algorithmId];
    const result = results[algorithmId];
    const stale = isResultStale(algorithmId);
    const isRunning = runningAlgorithms[algorithmId];
    const progress = progressMap[algorithmId];
    const availablePTO = Math.max(0, duration - rules.allocation.reservePTODays);

    const continuousBreakDates = useMemo(() => {
        if (!result || stale) return new Set<string>();
        return new Set(result.continuousBreakDates);
    }, [result, stale]);

    const displayedPTO = useMemo(() => {
        if (!result || stale) return [];
        return result.selectedPTODates;
    }, [result, stale]);

    const displayedICT = useMemo(() => {
        if (!result || stale) return [];
        return result.selectedICTDates;
    }, [result, stale]);

    const enabledSecondaries = Object.entries(rules.objectives.secondaries)
        .filter(([, cfg]) => cfg.enabled)
        .map(([k, cfg]) => `${k.replace(/_/g, ' ')} (w=${cfg.weight})`);

    return (
        <div className="pt-24 pb-20 container mx-auto px-6 space-y-8">
            {/* Top Navigation Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-semibold bg-white/60 dark:bg-white/5 border border-white/20 hover:bg-indigo-500/10 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Main Calendar & Shared Controls
                </button>

                <div className="flex flex-wrap items-center gap-2">
                    {(['ilp', 'cpsat', 'dp', 'greedy', 'genetic'] as AlgorithmId[]).map(id => {
                        const m = ALGORITHM_METADATA[id];
                        const isCurrent = id === algorithmId;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => navigate(m.route as AppRoute)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                                    isCurrent
                                        ? 'bg-indigo-600 text-white border-indigo-600'
                                        : 'bg-white/40 dark:bg-white/5 border-white/15 hover:bg-indigo-500/10'
                                }`}
                            >
                                {m.shortName}
                            </button>
                        );
                    })}
                    {selectedAlgorithmIds.length > 1 && (
                        <button
                            type="button"
                            onClick={() => navigate('/algorithms/compare')}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-500"
                        >
                            <BarChart3 className="w-3.5 h-3.5" />
                            Compare ({selectedAlgorithmIds.length})
                        </button>
                    )}
                </div>
            </div>

            {/* 1. Algorithm Name & 2. Short Explanation of Approach */}
            <div className="p-6 md:p-8 rounded-3xl bg-white/60 dark:bg-white/5 border border-white/20 backdrop-blur-sm space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2 max-w-3xl">
                        <div className="flex flex-wrap items-center gap-2.5">
                            <h1 className="text-2xl md:text-4xl font-extrabold bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
                                {meta.name}
                            </h1>
                            <span
                                className={`px-3 py-1 rounded-full text-xs font-bold ${
                                    meta.isExactCapable
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                                }`}
                            >
                                {meta.isExactCapable
                                    ? 'Exact Optimization Engine'
                                    : 'Heuristic Optimization Engine'}
                            </span>
                        </div>
                        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                            {meta.description}
                        </p>
                    </div>

                    {/* 5. Run Optimization Button */}
                    <div className="flex items-center gap-2">
                        {!selectedAlgorithms[algorithmId] && (
                            <button
                                type="button"
                                onClick={() => setAlgorithmSelected(algorithmId, true)}
                                className="px-3 py-2.5 rounded-xl text-xs font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25"
                            >
                                Enable in Main Selection
                            </button>
                        )}
                        <button
                            type="button"
                            disabled={isRunning}
                            onClick={() => {
                                if (!selectedAlgorithms[algorithmId]) {
                                    setAlgorithmSelected(algorithmId, true);
                                }
                                void runSingleAlgorithm(algorithmId);
                            }}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25 disabled:opacity-50"
                        >
                            {isRunning ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Running {meta.shortName}...
                                </>
                            ) : (
                                <>
                                    <Play className="w-4 h-4" />
                                    Run Optimization
                                </>
                            )}
                        </button>
                        {isRunning && (
                            <button
                                type="button"
                                onClick={cancelOptimization}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-300 border border-red-500/30"
                            >
                                <XCircle className="w-4 h-4" />
                                Cancel
                            </button>
                        )}
                    </div>
                </div>

                {/* 6. Optimization Status & Live Progress */}
                {isRunning && progress && (
                    <div className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 space-y-2 text-xs">
                        <div className="flex justify-between font-semibold">
                            <span>{progress.phase}</span>
                            <span>{progress.percent}%</span>
                        </div>
                        <div className="w-full h-2 bg-neutral-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-indigo-500 transition-all duration-200"
                                style={{ width: `${progress.percent}%` }}
                            />
                        </div>
                        <div className="flex flex-wrap gap-4 text-muted-foreground">
                            {progress.currentIteration !== undefined && (
                                <span>
                                    Iteration: {progress.currentIteration}
                                    {progress.maxIterations ? ` / ${progress.maxIterations}` : ''}
                                </span>
                            )}
                            {progress.bestScore !== undefined && (
                                <span>Best Primary Score: {progress.bestScore.toFixed(2)}</span>
                            )}
                            {progress.statesExplored !== undefined && (
                                <span>
                                    States/Nodes Explored:{' '}
                                    {progress.statesExplored.toLocaleString()}
                                </span>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* 3. Algorithm-Specific Configuration & 4. Shared Ruleset Summary */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-2">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                        Algorithm-Specific Configuration
                    </h2>
                    <SingleAlgorithmConfigCard algorithmId={algorithmId} showPageLink={false} />
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <Shield className="w-4 h-4 text-indigo-500" />
                            Shared Ruleset Summary (Synchronized with Main Widget)
                        </h2>
                        <button
                            type="button"
                            onClick={() => navigate('/')}
                            className="text-xs text-indigo-500 hover:underline font-medium"
                        >
                            Edit Shared Inputs on Main Widget →
                        </button>
                    </div>

                    <div className="p-4 rounded-2xl bg-white/60 dark:bg-white/5 border border-white/20 space-y-3 text-xs">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div className="p-2.5 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                <span className="text-muted-foreground block">Start Date</span>
                                <span className="font-bold text-sm">{startDate}</span>
                            </div>
                            <div className="p-2.5 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                <span className="text-muted-foreground block">End Date</span>
                                <span className="font-bold text-sm">{endDate}</span>
                            </div>
                            <div className="p-2.5 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                <span className="text-muted-foreground block">PTO Allowance</span>
                                <span className="font-bold text-sm text-indigo-600 dark:text-indigo-400">
                                    {duration} days
                                </span>
                            </div>
                            <div className="p-2.5 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                <span className="text-muted-foreground block">Available PTO</span>
                                <span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
                                    {availablePTO} days ({rules.allocation.reservePTODays} reserved)
                                </span>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-muted-foreground">
                            <div>
                                <strong>Primary Objective:</strong>{' '}
                                {rules.objectives.primary.replace(/_/g, ' ')}
                            </div>
                            <div>
                                <strong>Break Spacing:</strong> Min{' '}
                                {rules.distribution.minWorkingDaysBetweenBreaks} working days
                                {rules.distribution.minCalendarDaysBetweenBreaks
                                    ? `, ${rules.distribution.minCalendarDaysBetweenBreaks} calendar days`
                                    : ''}
                            </div>
                            <div>
                                <strong>Allocation Policy:</strong>{' '}
                                {rules.allocation.allowUnusedPTO
                                    ? `Unused allowed (min ${rules.allocation.minPTOToAllocate})`
                                    : 'Must allocate all available PTO'}
                                {rules.allocation.maxConsecutivePTOWorkingDays !== null
                                    ? ` • Max consecutive: ${rules.allocation.maxConsecutivePTOWorkingDays}d`
                                    : ' • Unlimited consecutive PTO'}
                            </div>
                            <div>
                                <strong>Restrictions:</strong>{' '}
                                {(rules.restrictions.requiredDateRanges ?? []).length} required range(s),{' '}
                                {rules.restrictions.prohibitedDateRanges.length} prohibited range(s)
                            </div>
                        </div>
                        {enabledSecondaries.length > 0 && (
                            <div className="text-muted-foreground pt-1 border-t border-white/10">
                                <strong>Secondary Objectives:</strong>{' '}
                                {enabledSecondaries.join(' • ')}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 8–13. Results Summary, Selected PTO, Days Off, Qualifying Breaks, Distribution, Constraint Validation */}
            {result ? (
                <ResultSummaryPanel
                    result={result}
                    isStale={stale}
                    onReRun={() => void runSingleAlgorithm(algorithmId)}
                />
            ) : (
                <div className="p-8 rounded-2xl bg-white/40 dark:bg-white/5 border border-dashed border-indigo-500/30 text-center space-y-3">
                    <CalendarIcon className="w-8 h-8 text-indigo-500 mx-auto" />
                    <h3 className="text-base font-bold">
                        No {meta.shortName} Optimization Run Yet
                    </h3>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                        Click &ldquo;Run Optimization&rdquo; above to execute {meta.name} on the
                        Singapore 2027 calendar using the shared ruleset.
                    </p>
                </div>
            )}

            {/* 7. Results Visualization (Shared Singapore 2027 Calendar Component) */}
            <div className="space-y-4">
                <h2 className="text-xl font-bold">
                    2027 Calendar Visualization ({meta.shortName})
                </h2>
                <SingaporeCalendarGrid
                    year={2027}
                    startDate={startDate}
                    endDate={endDate}
                    ptoDates={displayedPTO}
                    ictDates={displayedICT}
                    availableICTQuota={
                        rules.ict?.enabled
                            ? Math.max(0, rules.ict.annualICTQuota - rules.ict.reserveICTDays)
                            : undefined
                    }
                    continuousBreakDates={continuousBreakDates}
                />
            </div>
        </div>
    );
}
