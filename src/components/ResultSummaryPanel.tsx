import {
    AlertCircle,
    AlertTriangle,
    Award,
    CheckCircle2,
    Clock,
    ShieldAlert,
    ShieldCheck,
    TrendingUp
} from 'lucide-react';
import type { OptimizationResult } from '@/core';

function formatCategoryLabel(cat: string): string {
    if (!cat || cat === 'Uncategorized') return 'Uncategorized (< min duration)';
    return cat.charAt(0).toUpperCase() + cat.slice(1);
}

export function ResultSummaryPanel({
    result,
    isStale = false,
    onReRun
}: {
    result: OptimizationResult;
    isStale?: boolean;
    onReRun?: () => void;
}) {
    const isOptimal = result.status === 'optimal' && result.isExactOptimal;
    const isFeasible = result.status === 'feasible' || result.status === 'optimal';
    const isInfeasible = result.status === 'infeasible';

    return (
        <div className="space-y-6">
            {isStale && (
                <div className="p-4 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs md:text-sm">
                        <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
                        <span>
                            <strong>Stale Result Warning:</strong> Shared date, PTO allowance, or optimization rules have changed since this result was generated. Re-run optimization to update.
                        </span>
                    </div>
                    {onReRun && (
                        <button
                            type="button"
                            onClick={onReRun}
                            className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-bold hover:bg-amber-600 transition-colors"
                        >
                            Re-Run Now
                        </button>
                    )}
                </div>
            )}

            {/* Status & Optimality Banner */}
            <div
                className={`p-4 rounded-2xl border flex flex-wrap items-center justify-between gap-4 ${
                    isInfeasible
                        ? 'bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-200'
                        : isOptimal
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
                          : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-900 dark:text-indigo-200'
                }`}
            >
                <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-base">{result.algorithmName}</span>
                        <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
                                result.status === 'optimal'
                                    ? 'bg-emerald-500 text-white'
                                    : result.status === 'feasible'
                                      ? 'bg-indigo-500 text-white'
                                      : result.status === 'infeasible'
                                        ? 'bg-red-500 text-white'
                                        : 'bg-amber-500 text-white'
                            }`}
                        >
                            {result.status}
                        </span>
                        <span
                            className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                                result.isExactOptimal
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                    : result.optimalityGuarantee === 'heuristic'
                                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                      : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                            }`}
                        >
                            {result.isExactOptimal
                                ? 'Proven Global Optimum'
                                : result.optimalityGuarantee === 'heuristic'
                                  ? 'Heuristic (No Optimality Proof)'
                                  : result.optimalityGuarantee === 'feasible_within_gap'
                                    ? 'Feasible (Within Gap Tolerance)'
                                    : result.optimalityGuarantee === 'feasible_unproven'
                                      ? 'Feasible (Unproven Optimality)'
                                      : 'No Valid Solution'}
                        </span>
                    </div>
                    <p className="text-xs opacity-90">{result.statusMessage}</p>
                </div>

                <div className="flex items-center gap-4 text-xs">
                    <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4 opacity-75" />
                        <span>
                            Execution: <strong>{result.executionTimeMs.toFixed(2)} ms</strong>
                        </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <Award className="w-4 h-4 opacity-75" />
                        <span>
                            Primary Score:{' '}
                            <strong>{result.primaryObjectiveScore.toFixed(2)}</strong>
                        </span>
                    </div>
                </div>
            </div>

            {/* Warnings */}
            {result.warnings.length > 0 && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1 text-xs text-amber-800 dark:text-amber-300">
                    {result.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>{w}</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Optimization Statistics Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                    <span className="text-[11px] text-muted-foreground block">
                        Total Calendar Days Off (Breaks)
                    </span>
                    <span className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                        {result.totalCalendarDaysOff}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                        {result.totalNonWorkingCalendarDays} total non-working days in range
                    </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                    <span className="text-[11px] text-muted-foreground block">
                        PTO Consumed / Remaining
                    </span>
                    <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {result.totalPTOConsumed}{' '}
                        <span className="text-sm font-normal text-muted-foreground">
                            / {result.availablePTOAllowance}
                        </span>
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                        {result.remainingPTOAllowance} remaining • {result.reservedPTODays} reserved
                    </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                    <span className="text-[11px] text-muted-foreground block">
                        Qualifying Breaks
                    </span>
                    <span className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {result.numberOfQualifyingBreaks}
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                        {result.breaks.length} total active break block(s)
                    </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                    <span className="text-[11px] text-muted-foreground block">
                        Break Categories (S / M / L / E)
                    </span>
                    <div className="flex items-baseline gap-2 mt-1 text-sm font-bold">
                        <span title="Short breaks">S: {result.categoryCounts.short}</span>
                        <span title="Medium breaks">M: {result.categoryCounts.medium}</span>
                        <span title="Long breaks">L: {result.categoryCounts.long}</span>
                        <span
                            title="Extended breaks"
                            className="text-indigo-600 dark:text-indigo-400"
                        >
                            E: {result.categoryCounts.extended}
                        </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground block mt-1">
                        Category distribution
                    </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                    <span className="text-[11px] text-muted-foreground block">PTO Efficiency</span>
                    <span className="text-2xl font-bold text-pink-600 dark:text-pink-400">
                        {result.ptoEfficiency.toFixed(2)}x
                    </span>
                    <span className="text-[10px] text-muted-foreground block">
                        Break days off per PTO day
                    </span>
                </div>
            </div>

            {/* Selected PTO Dates */}
            <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/15 space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Selected PTO Dates ({result.selectedPTODates.length})
                </h4>
                {result.selectedPTODates.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        {isFeasible
                            ? '0 PTO days allocated for this solution.'
                            : 'No valid PTO allocation available.'}
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {result.selectedPTODates.map(d => (
                            <span
                                key={d}
                                className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                            >
                                {d}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Break Summary Table */}
            <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/15 space-y-3 overflow-x-auto">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Break Summary ({result.breaks.length} break block(s))
                </h4>
                {result.breaks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        No qualifying or PTO-enhanced breaks in this allocation.
                    </p>
                ) : (
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-white/15 text-muted-foreground">
                                <th className="py-2 px-3 font-semibold">Start Date</th>
                                <th className="py-2 px-3 font-semibold">End Date</th>
                                <th className="py-2 px-3 font-semibold text-right">Duration</th>
                                <th className="py-2 px-3 font-semibold text-right">PTO Used</th>
                                <th className="py-2 px-3 font-semibold">Category</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                            {result.breaks.map((b, idx) => (
                                <tr
                                    key={`${b.startDate}-${idx}`}
                                    className="hover:bg-indigo-500/5 transition-colors"
                                >
                                    <td className="py-2 px-3 font-medium">{b.startDate}</td>
                                    <td className="py-2 px-3 font-medium">{b.endDate}</td>
                                    <td className="py-2 px-3 text-right font-semibold">
                                        {b.duration} days
                                    </td>
                                    <td className="py-2 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                        {b.ptoUsed}
                                    </td>
                                    <td className="py-2 px-3">
                                        <span
                                            className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                                                b.primaryCategory === 'extended'
                                                    ? 'bg-purple-500/20 text-purple-700 dark:text-purple-300'
                                                    : b.primaryCategory === 'long'
                                                      ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                                                      : b.primaryCategory === 'medium'
                                                        ? 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
                                                        : b.primaryCategory === 'short'
                                                          ? 'bg-teal-500/20 text-teal-700 dark:text-teal-300'
                                                          : 'bg-neutral-500/20 text-muted-foreground'
                                            }`}
                                        >
                                            {formatCategoryLabel(b.primaryCategory)}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* GA Convergence History (if present) */}
            {result.convergenceHistory && result.convergenceHistory.length > 1 && (
                <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/15 space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                            <TrendingUp className="w-4 h-4 text-indigo-500" />
                            Genetic Algorithm Convergence Progress
                        </h4>
                        <span className="text-xs text-muted-foreground">
                            {result.convergenceHistory.length} checkpoints recorded
                        </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-40 overflow-y-auto text-xs">
                        {result.convergenceHistory.slice(-12).map(pt => (
                            <div
                                key={pt.generation}
                                className="p-2 rounded-lg bg-white/50 dark:bg-black/30 border border-white/10"
                            >
                                <span className="text-[10px] text-muted-foreground block">
                                    Gen {pt.generation}
                                </span>
                                <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                    Best: {pt.bestFitness}
                                </span>
                                <span className="text-[10px] text-muted-foreground block">
                                    Avg: {pt.averageFitness}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Constraint Validation Details (Hard Constraints vs Soft Preferences) */}
            <div className="p-4 rounded-2xl bg-white/50 dark:bg-black/20 border border-white/15 space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                        {result.validation.isValid ? (
                            <ShieldCheck className="w-4 h-4 text-emerald-500" />
                        ) : (
                            <ShieldAlert className="w-4 h-4 text-red-500" />
                        )}
                        Constraint Validation ({result.validation.isValid ? 'All Hard Constraints Satisfied' : 'Hard Constraint Violation'})
                    </h4>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-2">
                        <span className="font-semibold text-muted-foreground block">
                            Hard Constraints (Mandatory)
                        </span>
                        <div className="space-y-1.5">
                            {result.validation.hardConstraints.map(c => (
                                <div
                                    key={c.code}
                                    className={`p-2 rounded-lg border flex items-start gap-2 ${
                                        c.satisfied
                                            ? 'bg-emerald-500/5 border-emerald-500/20 text-foreground'
                                            : 'bg-red-500/15 border-red-500/40 text-red-700 dark:text-red-300 font-semibold'
                                    }`}
                                >
                                    <CheckCircle2
                                        className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
                                            c.satisfied ? 'text-emerald-500' : 'text-red-500'
                                        }`}
                                    />
                                    <span>{c.message}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <span className="font-semibold text-muted-foreground block">
                            Soft Preferences (Optimization Targets)
                        </span>
                        {result.validation.softPreferences.length === 0 ? (
                            <p className="text-muted-foreground text-xs">
                                No optional soft preferences enabled.
                            </p>
                        ) : (
                            <div className="space-y-1.5">
                                {result.validation.softPreferences.map(s => (
                                    <div
                                        key={s.code}
                                        className="p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/20 flex items-start gap-2"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
                                        <span>{s.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
