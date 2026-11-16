import { useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
    AlertCircle,
    BarChart3,
    CheckSquare,
    ExternalLink,
    Loader2,
    Play,
    Sparkles,
    Square,
    XCircle
} from 'lucide-react';
import { getMaximizePTO } from '@/lib/maxleavealgorithm';
import {
    ALGORITHM_METADATA,
    PUBLIC_HOLIDAYS_2027,
    analyzeBreaks,
    buildCalendarDays,
    type AlgorithmId
} from '@/core';
import { useOptimization, type AppRoute } from '@/context/OptimizationContext';
import { OptimizationRulesPanel } from './OptimizationRulesPanel';
import { ResultSummaryPanel } from './ResultSummaryPanel';

export { PUBLIC_HOLIDAYS_2027 };

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const ALL_ALGORITHMS: AlgorithmId[] = ['ilp', 'cpsat', 'dp', 'greedy', 'genetic'];

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
}

export interface SingaporeCalendarGridProps {
    year?: number;
    startDate: string;
    endDate: string;
    ptoDates: string[];
    manualPTODates?: Set<string>;
    continuousBreakDates?: Set<string>;
    onDateClick?: (
        dateStr: string,
        isOutOfRange: boolean,
        isWeekend: boolean,
        isHoliday: boolean
    ) => void;
    compact?: boolean;
}

/**
 * Shared 12-month Singapore 2027 Calendar visualization component reused across
 * the main page, individual algorithm pages, and the comparison view.
 */
export function SingaporeCalendarGrid({
    year = 2027,
    startDate,
    endDate,
    ptoDates,
    manualPTODates = new Set(),
    continuousBreakDates = new Set(),
    onDateClick,
    compact = false
}: SingaporeCalendarGridProps) {
    const ptoSet = useMemo(() => new Set(ptoDates), [ptoDates]);

    return (
        <div>
            <div className="text-center mb-6 text-xs md:text-sm flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <span>
                    <span className="inline-block mr-1.5 w-3 h-3 rounded-full bg-red-500/80 align-middle"></span>
                    Public Holiday
                </span>
                <span>
                    <span className="inline-block mr-1.5 w-3 h-3 rounded-full bg-indigo-500/20 align-middle"></span>
                    Weekend
                </span>
                <span>
                    <span className="inline-block mr-1.5 w-3 h-3 rounded-full bg-purple-400/60 align-middle"></span>
                    Manual PTO
                </span>
                <span>
                    <span className="inline-block mr-1.5 w-3 h-3 rounded-full bg-green-500/80 align-middle"></span>
                    Allocated / Suggested PTO
                </span>
                <span>
                    <span className="inline-block mr-1.5 w-3 h-3 rounded-full ring-2 ring-amber-400 bg-amber-400/20 align-middle"></span>
                    Continuous Break
                </span>
            </div>

            <div
                className={cn(
                    'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
                    compact ? 'gap-4' : 'gap-8'
                )}
            >
                {MONTHS.map((monthName, monthIndex) => {
                    const daysInMonth = getDaysInMonth(year, monthIndex);
                    const firstDay = getFirstDayOfMonth(year, monthIndex);
                    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
                    const paddingDays = Array.from({ length: firstDay }, () => null);

                    return (
                        <div
                            key={monthName}
                            className={cn(
                                'bg-white/50 dark:bg-white/5 border border-white/20 backdrop-blur-sm rounded-3xl transition-all duration-300',
                                compact
                                    ? 'p-4'
                                    : 'p-6 hover:shadow-xl hover:-translate-y-1'
                            )}
                        >
                            <h3 className="text-xl font-bold mb-4 text-center">{monthName}</h3>

                            <div className="grid grid-cols-7 gap-1 text-center mb-2">
                                {DAYS.map((day, index) => (
                                    <div
                                        key={`${day}-${index}`}
                                        className="text-xs font-semibold text-muted-foreground"
                                    >
                                        {day}
                                    </div>
                                ))}
                            </div>

                            <div className="grid grid-cols-7 gap-1 text-center text-sm">
                                {paddingDays.map((_, i) => (
                                    <div key={`pad-${i}`} />
                                ))}

                                {days.map((day, index) => {
                                    const dateStr = `${year}-${String(monthIndex + 1).padStart(
                                        2,
                                        '0'
                                    )}-${String(day).padStart(2, '0')}`;
                                    const holiday = PUBLIC_HOLIDAYS_2027.find(
                                        h => h.date === dateStr
                                    );
                                    const isPTO = ptoSet.has(dateStr);
                                    const isManualPTO = manualPTODates.has(dateStr);
                                    const isInContinuousBreak = continuousBreakDates.has(dateStr);
                                    const date = new Date(year, monthIndex, day);
                                    const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                                    const isPast = dateStr < startDate;
                                    const isAfterEnd = dateStr > endDate;
                                    const isOutOfRange = isPast || isAfterEnd;

                                    const canClick =
                                        !!onDateClick && !isOutOfRange && !isWeekend && !holiday;

                                    return (
                                        <div
                                            key={`${day}-${index}`}
                                            onClick={() =>
                                                onDateClick?.(
                                                    dateStr,
                                                    isOutOfRange,
                                                    isWeekend,
                                                    !!holiday
                                                )
                                            }
                                            className={cn(
                                                'aspect-square flex items-center justify-center rounded-lg transition-colors relative group',
                                                isOutOfRange &&
                                                    'opacity-25 line-through cursor-not-allowed',
                                                !isOutOfRange &&
                                                    isInContinuousBreak &&
                                                    'ring-2 ring-amber-400/75 ring-offset-1 ring-offset-transparent',
                                                !isOutOfRange &&
                                                    isWeekend &&
                                                    'bg-indigo-500/5 text-indigo-700 dark:text-indigo-300 cursor-default',
                                                !isOutOfRange && holiday
                                                    ? 'bg-red-500 text-white font-bold shadow-md shadow-red-500/20 cursor-default'
                                                    : !isOutOfRange && isManualPTO
                                                      ? 'bg-purple-400/60 text-white font-bold shadow-md shadow-purple-500/20 cursor-pointer'
                                                      : !isOutOfRange && isPTO
                                                        ? 'bg-green-500 text-white font-bold shadow-md shadow-green-500/20 cursor-default'
                                                        : canClick
                                                          ? 'hover:bg-neutral-100 dark:hover:bg-white/10 cursor-pointer'
                                                          : 'cursor-default'
                                            )}
                                            title={
                                                holiday?.name ??
                                                (isManualPTO
                                                    ? 'Manual PTO (click to remove)'
                                                    : isPTO
                                                      ? 'Allocated / Suggested PTO'
                                                      : isInContinuousBreak
                                                        ? 'Part of Continuous Break'
                                                        : canClick
                                                          ? 'Click to select PTO'
                                                          : undefined)
                                            }
                                        >
                                            {day}
                                            {(holiday ||
                                                isPTO ||
                                                isManualPTO ||
                                                isInContinuousBreak) &&
                                                !isOutOfRange && (
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                                        {holiday
                                                            ? holiday.name
                                                            : isManualPTO
                                                              ? 'Manual PTO'
                                                              : isPTO
                                                                ? 'Allocated PTO'
                                                                : 'Continuous Break'}
                                                    </div>
                                                )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function Calendar() {
    const year = 2027;
    const {
        startDate,
        setStartDate,
        endDate,
        setEndDate,
        duration,
        setDuration,
        includeWeekends,
        setIncludeWeekends,
        manualPTODates,
        toggleManualPTODate,
        clearManualPTODates,
        selectedAlgorithms,
        toggleAlgorithm,
        selectedAlgorithmIds,
        rules,
        results,
        progressMap,
        isRunning,
        runningAlgorithms,
        runSelectedAlgorithms,
        runSingleAlgorithm,
        cancelOptimization,
        isResultStale,
        hasAnyStaleResults,
        activeCalendarSource,
        setActiveCalendarSource,
        navigate
    } = useOptimization();

    const remainingPTO = Math.max(0, duration - manualPTODates.size);

    // Existing legacy PTO suggestions (respecting blackout dates and prohibited date ranges)
    const legacyPTODates = useMemo(() => {
        const manualHolidays = Array.from(manualPTODates).map(date => ({
            date,
            name: 'Manual PTO'
        }));
        const allHolidays = [...PUBLIC_HOLIDAYS_2027, ...manualHolidays];
        const calDays = buildCalendarDays(
            startDate,
            endDate,
            PUBLIC_HOLIDAYS_2027,
            rules.restrictions
        );
        const excludedDates = new Set<string>();
        for (const d of calDays) {
            if (d.isBlackout) {
                excludedDates.add(d.date);
            }
        }
        return getMaximizePTO(startDate, remainingPTO, allHolidays, endDate, excludedDates);
    }, [startDate, endDate, remainingPTO, manualPTODates, rules.restrictions]);

    // Determine which PTO dates and continuous break dates to render on the main calendar
    const activeAlgoResult =
        activeCalendarSource !== 'legacy' && !isResultStale(activeCalendarSource)
            ? results[activeCalendarSource]
            : undefined;

    const displayedPTODates = activeAlgoResult
        ? activeAlgoResult.selectedPTODates
        : legacyPTODates;

    const continuousBreakDates = useMemo(() => {
        if (activeAlgoResult) {
            return new Set(activeAlgoResult.continuousBreakDates);
        }
        const calDays = buildCalendarDays(
            startDate,
            endDate,
            PUBLIC_HOLIDAYS_2027,
            rules.restrictions
        );
        const combinedPTO = [...legacyPTODates, ...Array.from(manualPTODates)];
        const { continuousBreakDates: legacyBreakDates } = analyzeBreaks(
            calDays,
            combinedPTO,
            rules.breakDuration
        );
        return new Set(legacyBreakDates);
    }, [activeAlgoResult, startDate, endDate, legacyPTODates, manualPTODates, rules]);

    useEffect(() => {
        // Keep manualPTODates valid when duration shrinks
    }, [duration]);

    const handleDateClick = (
        dateStr: string,
        isOutOfRange: boolean,
        isWeekend: boolean,
        isHoliday: boolean
    ) => {
        if (isOutOfRange || isWeekend || isHoliday) return;
        toggleManualPTODate(dateStr);
    };

    const freshResultIds = ALL_ALGORITHMS.filter(
        id => results[id] && !isResultStale(id)
    );

    return (
        <section id="calendar" className="py-24 bg-background relative overflow-hidden">
            <div className="container mx-auto px-6 relative z-10">
                <div className="text-center mb-12">
                    <h2 className="text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
                        2027 Calendar
                    </h2>
                    <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                        Plan your holidays around these official dates.
                    </p>
                </div>

                {/* Active Calendar Visualization Mode Switcher */}
                <div className="mb-8 flex flex-wrap items-center justify-center gap-2">
                    <span className="text-xs font-semibold text-muted-foreground mr-1">
                        Visualizing on Calendar:
                    </span>
                    <button
                        type="button"
                        onClick={() => setActiveCalendarSource('legacy')}
                        className={cn(
                            'px-3 py-1.5 rounded-full text-xs font-semibold transition-all border',
                            activeCalendarSource === 'legacy'
                                ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-500/20'
                                : 'bg-white/50 dark:bg-white/5 border-white/20 hover:bg-indigo-500/10'
                        )}
                    >
                        Default Quick Planner ({legacyPTODates.length} PTO)
                    </button>
                    {ALL_ALGORITHMS.map(id => {
                        const res = results[id];
                        const stale = isResultStale(id);
                        if (!res || stale) return null;
                        const meta = ALGORITHM_METADATA[id];
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setActiveCalendarSource(id)}
                                className={cn(
                                    'px-3 py-1.5 rounded-full text-xs font-semibold transition-all border',
                                    activeCalendarSource === id
                                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-500/20'
                                        : 'bg-white/50 dark:bg-white/5 border-white/20 hover:bg-emerald-500/10'
                                )}
                            >
                                {meta.shortName}: {res.totalCalendarDaysOff}d off (
                                {res.totalPTOConsumed} PTO)
                            </button>
                        );
                    })}
                </div>

                <SingaporeCalendarGrid
                    year={year}
                    startDate={startDate}
                    endDate={endDate}
                    ptoDates={displayedPTODates}
                    manualPTODates={
                        activeCalendarSource === 'legacy' ? manualPTODates : new Set()
                    }
                    continuousBreakDates={continuousBreakDates}
                    onDateClick={handleDateClick}
                />

                {/* Main Enhanced PTO Widget */}
                <div className="mt-16 max-w-5xl mx-auto p-6 md:p-8 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/20 backdrop-blur-sm">
                    {/* Section 2A: Algorithm Selection Checkboxes ABOVE Start Date / End Date */}
                    <div className="mb-8 p-5 rounded-2xl bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border border-indigo-500/20">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                            <div>
                                <h3 className="text-base md:text-lg font-bold flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-indigo-500" />
                                    Optimization Algorithms
                                </h3>
                                <p className="text-xs text-muted-foreground">
                                    Select one or more algorithms to configure, execute, and compare using your shared date range and PTO allowance below.
                                </p>
                            </div>
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30">
                                {selectedAlgorithmIds.length} of 5 selected
                            </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                            {ALL_ALGORITHMS.map(id => {
                                const meta = ALGORITHM_METADATA[id];
                                const checked = selectedAlgorithms[id];
                                const isAlgoRunning = runningAlgorithms[id];
                                const hasRes = !!results[id];
                                const stale = isResultStale(id);

                                return (
                                    <div
                                        key={id}
                                        className={cn(
                                            'p-3 rounded-xl border transition-all flex items-center justify-between gap-2',
                                            checked
                                                ? 'bg-indigo-500/10 border-indigo-500/40 shadow-sm'
                                                : 'bg-white/40 dark:bg-black/20 border-white/10 opacity-75 hover:opacity-100'
                                        )}
                                    >
                                        <label className="flex items-center gap-2.5 cursor-pointer flex-1 min-w-0">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleAlgorithm(id)}
                                                className="sr-only"
                                            />
                                            {checked ? (
                                                <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                                            ) : (
                                                <Square className="w-4 h-4 text-muted-foreground shrink-0" />
                                            )}
                                            <div className="truncate">
                                                <span className="text-xs font-bold block truncate">
                                                    {meta.name}
                                                </span>
                                                <span className="text-[10px] text-muted-foreground">
                                                    {isAlgoRunning
                                                        ? 'Running...'
                                                        : hasRes
                                                          ? stale
                                                              ? 'Result stale (settings changed)'
                                                              : `${results[id]!.status.toUpperCase()} • ${results[id]!.totalCalendarDaysOff}d off`
                                                          : meta.isExactCapable
                                                            ? 'Exact solver'
                                                            : 'Heuristic solver'}
                                                </span>
                                            </div>
                                        </label>

                                        {checked && (
                                            <button
                                                type="button"
                                                onClick={() => navigate(meta.route as AppRoute)}
                                                className="p-1.5 rounded-lg text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 transition-colors shrink-0"
                                                title={`Open ${meta.name} dedicated page`}
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {selectedAlgorithmIds.length === 0 && (
                            <div className="mt-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0" />
                                <span>
                                    Select at least one optimization algorithm above to enable execution.
                                </span>
                            </div>
                        )}

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    type="button"
                                    disabled={selectedAlgorithmIds.length === 0 || isRunning}
                                    onClick={() => void runSelectedAlgorithms()}
                                    className={cn(
                                        'inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs md:text-sm font-bold transition-all',
                                        selectedAlgorithmIds.length === 0 || isRunning
                                            ? 'bg-neutral-300 dark:bg-zinc-800 text-muted-foreground cursor-not-allowed'
                                            : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25'
                                    )}
                                >
                                    {isRunning ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Running Selected ({selectedAlgorithmIds.length})...
                                        </>
                                    ) : (
                                        <>
                                            <Play className="w-4 h-4" />
                                            Run Selected Algorithms ({selectedAlgorithmIds.length})
                                        </>
                                    )}
                                </button>

                                {isRunning && (
                                    <button
                                        type="button"
                                        onClick={cancelOptimization}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-500/15 text-red-600 dark:text-red-300 border border-red-500/30 hover:bg-red-500/25"
                                    >
                                        <XCircle className="w-4 h-4" />
                                        Cancel
                                    </button>
                                )}

                                {selectedAlgorithmIds.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => navigate('/algorithms/compare')}
                                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 hover:bg-purple-500/25 transition-colors"
                                    >
                                        <BarChart3 className="w-4 h-4" />
                                        Compare Selected ({selectedAlgorithmIds.length})
                                    </button>
                                )}
                            </div>

                            {hasAnyStaleResults && (
                                <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                                    Configuration updated — click &ldquo;Run Selected Algorithms&rdquo; to refresh results.
                                </span>
                            )}
                        </div>

                        {/* Live Execution Progress */}
                        {isRunning && (
                            <div className="mt-3 space-y-2">
                                {selectedAlgorithmIds
                                    .filter(id => runningAlgorithms[id] || progressMap[id])
                                    .map(id => {
                                        const prog = progressMap[id];
                                        if (!prog) return null;
                                        return (
                                            <div key={id} className="text-xs space-y-1">
                                                <div className="flex justify-between">
                                                    <span className="font-semibold">
                                                        {ALGORITHM_METADATA[id].shortName}:{' '}
                                                        {prog.phase}
                                                    </span>
                                                    <span>{prog.percent}%</span>
                                                </div>
                                                <div className="w-full h-1.5 bg-neutral-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-indigo-500 transition-all duration-200"
                                                        style={{ width: `${prog.percent}%` }}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )}
                    </div>

                    {/* Section 2B: Existing Start Date, End Date, PTO Slider, and Stats */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label
                                        htmlFor="start-date"
                                        className="block text-sm font-semibold mb-2"
                                    >
                                        Start Date
                                    </label>
                                    <input
                                        id="start-date"
                                        type="date"
                                        value={startDate}
                                        min="2027-01-01"
                                        max={endDate}
                                        onChange={e => setStartDate(e.target.value)}
                                        className="w-full px-4 py-2 rounded-lg bg-white/50 dark:bg-black/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                                <div>
                                    <label
                                        htmlFor="end-date"
                                        className="block text-sm font-semibold mb-2"
                                    >
                                        End Date
                                    </label>
                                    <input
                                        id="end-date"
                                        type="date"
                                        value={endDate}
                                        min={startDate}
                                        max="2027-12-31"
                                        onChange={e => setEndDate(e.target.value)}
                                        className="w-full px-4 py-2 rounded-lg bg-white/50 dark:bg-black/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label
                                        htmlFor="duration-slider"
                                        className="text-sm font-semibold"
                                    >
                                        Total PTO Days
                                    </label>
                                    <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                                        {duration} days
                                    </span>
                                </div>
                                <div className="flex items-center justify-between mb-2 text-sm">
                                    <span className="text-muted-foreground">Manual PTO:</span>
                                    <span className="font-semibold text-purple-600 dark:text-purple-400">
                                        {manualPTODates.size} days
                                    </span>
                                </div>
                                <div className="flex items-center justify-between mb-2 text-sm">
                                    <span className="text-muted-foreground">
                                        Available for suggestions:
                                    </span>
                                    <span className="font-semibold text-green-600 dark:text-green-400">
                                        {remainingPTO} days
                                    </span>
                                </div>
                                {manualPTODates.size > 0 && (
                                    <button
                                        onClick={clearManualPTODates}
                                        className="w-full mt-2 mb-2 px-4 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-700 dark:text-purple-300 font-semibold text-sm transition-all duration-200 hover:shadow-md hover:shadow-purple-500/10"
                                    >
                                        Clear All Manual PTOs
                                    </button>
                                )}
                                <input
                                    id="duration-slider"
                                    type="range"
                                    min="0"
                                    max="30"
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-500"
                                />
                                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                                    <span>0 days</span>
                                    <span>7 days</span>
                                    <span>14 days</span>
                                    <span>30 days</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/40 dark:bg-black/20 rounded-xl p-6 border border-white/10 flex flex-col justify-center space-y-4">
                            {(() => {
                                const calDays = buildCalendarDays(
                                    startDate,
                                    endDate,
                                    PUBLIC_HOLIDAYS_2027
                                );
                                const ptoSet = new Set(displayedPTODates);

                                let working = 0;
                                let nonWorking = 0;

                                for (const d of calDays) {
                                    if (!includeWeekends && d.isWeekend) {
                                        continue;
                                    }
                                    const isManual =
                                        activeCalendarSource === 'legacy' &&
                                        manualPTODates.has(d.date);
                                    if (d.isWeekend || d.isPublicHoliday || ptoSet.has(d.date) || isManual) {
                                        nonWorking++;
                                    } else {
                                        working++;
                                    }
                                }

                                return (
                                    <>
                                        <div className="flex justify-between items-center border-b border-indigo-500/20 pb-2">
                                            <span className="text-muted-foreground">
                                                Working Days
                                            </span>
                                            <span className="text-2xl font-bold">{working}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2">
                                            <span className="text-muted-foreground">
                                                Non-Working Days
                                            </span>
                                            <span className="text-2xl font-bold text-indigo-500">
                                                {nonWorking}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-center gap-2 mt-4 pt-2 border-t border-white/10">
                                            <input
                                                type="checkbox"
                                                id="include-weekends"
                                                checked={includeWeekends}
                                                onChange={e =>
                                                    setIncludeWeekends(e.target.checked)
                                                }
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <label
                                                htmlFor="include-weekends"
                                                className="text-xs text-muted-foreground cursor-pointer select-none"
                                            >
                                                Include Weekends
                                            </label>
                                        </div>

                                        <div className="text-[10px] text-center text-muted-foreground/50 mt-1">
                                            (From {startDate} to {endDate})
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Section 2C & 3: Collapsible Shared Optimization Rules & Preferences */}
                    <OptimizationRulesPanel />
                </div>

                {/* Inline Algorithm Results & Comparison Preview when algorithms have executed */}
                {freshResultIds.length > 0 && (
                    <div className="mt-12 max-w-5xl mx-auto space-y-6">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-xl font-bold">
                                Optimization Results ({freshResultIds.length} algorithm(s))
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {freshResultIds.map(id => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setActiveCalendarSource(id)}
                                        className={cn(
                                            'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                                            activeCalendarSource === id
                                                ? 'bg-indigo-600 text-white border-indigo-600'
                                                : 'bg-white/50 dark:bg-white/5 border-white/20 hover:bg-indigo-500/10'
                                        )}
                                    >
                                        View {ALGORITHM_METADATA[id].shortName}
                                    </button>
                                ))}
                                {freshResultIds.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => navigate('/algorithms/compare')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 text-white hover:bg-purple-500 transition-colors"
                                    >
                                        Open Full Comparison View
                                    </button>
                                )}
                            </div>
                        </div>

                        {activeAlgoResult ? (
                            <ResultSummaryPanel
                                result={activeAlgoResult}
                                isStale={isResultStale(activeAlgoResult.algorithmId)}
                                onReRun={() =>
                                    void runSingleAlgorithm(activeAlgoResult.algorithmId)
                                }
                            />
                        ) : (
                            results[freshResultIds[0]] && (
                                <ResultSummaryPanel
                                    result={results[freshResultIds[0]]!}
                                    isStale={isResultStale(freshResultIds[0])}
                                    onReRun={() => void runSingleAlgorithm(freshResultIds[0])}
                                />
                            )
                        )}
                    </div>
                )}
            </div>
        </section>
    );
}
