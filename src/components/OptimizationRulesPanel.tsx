import { useState } from 'react';
import {
    AlertTriangle,
    CalendarOff,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Edit2,
    Plus,
    RotateCcw,
    Shield,
    Sliders,
    Trash2
} from 'lucide-react';
import { useOptimization } from '@/context/OptimizationContext';
import {
    PUBLIC_HOLIDAYS_2027,
    diffCalendarDays,
    isDateInProhibitedRange,
    type BreakCategoryName,
    type PrimaryObjective,
    type SecondaryObjectiveKey
} from '@/core';

const PRIMARY_OBJECTIVE_OPTIONS: Array<{ value: PrimaryObjective; label: string }> = [
    { value: 'maximize_total_days_off', label: 'Maximize total continuous days away from work' },
    { value: 'maximize_qualifying_breaks', label: 'Maximize number of qualifying breaks' },
    { value: 'maximize_extended_breaks', label: 'Maximize number of extended breaks' },
    { value: 'maximize_pto_efficiency', label: 'Maximize PTO efficiency' },
    { value: 'maximize_ict_utilization', label: 'Maximize ICT utilization' },
    { value: 'maximize_break_distribution', label: 'Distribute ICT periods & breaks throughout the year' },
    {
        value: 'combine_ict_with_pto_and_holidays',
        label: 'Combine ICT with PTO and public holidays to create longer breaks'
    },
    {
        value: 'minimize_pto_consumption',
        label: 'Minimize PTO consumption while satisfying break requirements'
    }
];

const SECONDARY_OBJECTIVE_LABELS: Array<{ key: SecondaryObjectiveKey; label: string }> = [
    { key: 'prefer_longer_breaks', label: 'Prefer longer continuous breaks' },
    { key: 'prefer_more_frequent_breaks', label: 'Prefer more frequent breaks throughout the year' },
    { key: 'prefer_evenly_distributed_breaks', label: 'Prefer evenly distributed breaks' },
    { key: 'minimize_consecutive_pto', label: 'Minimize consecutive PTO working days' },
    { key: 'minimize_unused_pto', label: 'Minimize unused PTO' },
    { key: 'maximize_total_days_off', label: 'Maximize total calendar days off' },
    { key: 'prefer_combining_ict_with_weekends', label: 'Prefer combining ICT with weekends' },
    { key: 'prefer_combining_ict_with_holidays', label: 'Prefer combining ICT with public holidays' },
    { key: 'prefer_connecting_ict_with_pto', label: 'Prefer connecting ICT periods with PTO' },
    { key: 'avoid_concentrating_ict', label: 'Avoid concentrating all ICT allocation in one part of the year' },
    { key: 'preserve_pto_for_non_ict', label: 'Preserve some PTO allowance for non-ICT holidays' }
];

const BREAK_CATEGORIES: Array<{
    key: BreakCategoryName;
    label: string;
    defaultDays: number;
}> = [
        { key: 'short', label: 'Short break', defaultDays: 4 },
        { key: 'medium', label: 'Medium break', defaultDays: 7 },
        { key: 'long', label: 'Long break', defaultDays: 10 },
        { key: 'extended', label: 'Extended break', defaultDays: 14 }
    ];

function isWeekendOrHoliday(dateStr: string): string | null {
    if (!dateStr) return null;
    const parts = dateStr.split('-').map(Number);
    if (parts.length !== 3) return null;
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return 'Weekend (already non-working)';
    const ph = PUBLIC_HOLIDAYS_2027.find(h => h.date === dateStr);
    if (ph) return `Public Holiday: ${ph.name} (already non-working)`;
    return null;
}

export function OptimizationRulesPanel() {
    const { startDate, endDate, duration, rules, setRules, resetRules } = useOptimization();
    const [isOpen, setIsOpen] = useState(false);

    // Date restriction input states
    const [newReqRangeStart, setNewReqRangeStart] = useState('');
    const [newReqRangeEnd, setNewReqRangeEnd] = useState('');
    const [newReqRangeLabel, setNewReqRangeLabel] = useState('');
    const [newRangeStart, setNewRangeStart] = useState('');
    const [newRangeEnd, setNewRangeEnd] = useState('');
    const [newRangeLabel, setNewRangeLabel] = useState('');
    const [restrictionWarning, setRestrictionWarning] = useState<string | null>(null);

    // ICT manual period input & edit states
    const [newICTStart, setNewICTStart] = useState('');
    const [newICTEnd, setNewICTEnd] = useState('');
    const [newICTLabel, setNewICTLabel] = useState('');
    const [editingICTId, setEditingICTId] = useState<string | null>(null);
    const [editICTStart, setEditICTStart] = useState('');
    const [editICTEnd, setEditICTEnd] = useState('');
    const [editICTLabel, setEditICTLabel] = useState('');
    const [ictWarning, setIctWarning] = useState<string | null>(null);

    const availablePTO = Math.max(0, duration - rules.allocation.reservePTODays);
    const requiredDateRanges = rules.restrictions.requiredDateRanges ?? [];
    const ictRules = rules.ict;
    const availableICTQuota = Math.max(0, ictRules.annualICTQuota - ictRules.reserveICTDays);
    const fixedICTDaysConsumed = ictRules.fixedICTPeriods.reduce(
        (sum, p) => sum + (p.startDate <= p.endDate ? diffCalendarDays(p.startDate, p.endDate) + 1 : 0),
        0
    );

    const handleAddFixedICTPeriod = () => {
        setIctWarning(null);
        if (!newICTStart || !newICTEnd) return;
        if (newICTStart > newICTEnd) {
            setIctWarning('ICT period Start Date must be on or before End Date.');
            return;
        }
        if (newICTStart < startDate || newICTEnd > endDate) {
            setIctWarning(`ICT period [${newICTStart} to ${newICTEnd}] must fall within [${startDate} to ${endDate}].`);
            return;
        }
        const overlappingFixed = ictRules.fixedICTPeriods.find(
            p => p.startDate <= newICTEnd && p.endDate >= newICTStart
        );
        if (overlappingFixed) {
            setIctWarning(
                `Conflict: ICT period [${newICTStart} to ${newICTEnd}] overlaps existing ICT period [${overlappingFixed.startDate} to ${overlappingFixed.endDate}].`
            );
            return;
        }
        const overlappingReq = requiredDateRanges.find(
            r => r.startDate <= newICTEnd && r.endDate >= newICTStart
        );
        if (overlappingReq) {
            setIctWarning(
                `Conflict: ICT period [${newICTStart} to ${newICTEnd}] overlaps Required PTO range [${overlappingReq.startDate} to ${overlappingReq.endDate}].`
            );
            return;
        }
        const overlappingPro = rules.restrictions.prohibitedDateRanges.find(
            r => r.startDate <= newICTEnd && r.endDate >= newICTStart
        );
        if (overlappingPro) {
            setIctWarning(
                `Conflict: ICT period [${newICTStart} to ${newICTEnd}] overlaps Prohibited range [${overlappingPro.startDate} to ${overlappingPro.endDate}].`
            );
            return;
        }
        const periodDays = diffCalendarDays(newICTStart, newICTEnd) + 1;
        if (fixedICTDaysConsumed + periodDays > availableICTQuota) {
            setIctWarning(
                `Adding this ${periodDays}-day ICT period (${fixedICTDaysConsumed + periodDays}d total) exceeds available ICT quota (${availableICTQuota}d).`
            );
            return;
        }
        setRules(prev => ({
            ...prev,
            ict: {
                ...prev.ict,
                fixedICTPeriods: [
                    ...prev.ict.fixedICTPeriods,
                    {
                        id: `ict_${newICTStart}_${newICTEnd}_${Date.now()}`,
                        startDate: newICTStart,
                        endDate: newICTEnd,
                        label: newICTLabel.trim() || undefined
                    }
                ]
            }
        }));
        setNewICTStart('');
        setNewICTEnd('');
        setNewICTLabel('');
    };

    const handleSaveEditICTPeriod = (id: string) => {
        setIctWarning(null);
        if (!editICTStart || !editICTEnd || editICTStart > editICTEnd) {
            setIctWarning('Edited ICT period Start Date must be on or before End Date.');
            return;
        }
        setRules(prev => ({
            ...prev,
            ict: {
                ...prev.ict,
                fixedICTPeriods: prev.ict.fixedICTPeriods.map(p =>
                    p.id === id
                        ? {
                              ...p,
                              startDate: editICTStart,
                              endDate: editICTEnd,
                              label: editICTLabel.trim() || undefined
                          }
                        : p
                )
            }
        }));
        setEditingICTId(null);
    };

    // Detect any conflict between required PTO ranges/dates and prohibited ranges
    const conflicts: string[] = [];
    const blackoutSet = new Set(rules.restrictions.blackoutDates);
    for (const req of rules.restrictions.requiredPTODates) {
        if (blackoutSet.has(req) || isDateInProhibitedRange(req, rules.restrictions)) {
            conflicts.push(req);
        }
    }
    for (const reqRange of requiredDateRanges) {
        for (const proRange of rules.restrictions.prohibitedDateRanges) {
            if (reqRange.startDate <= proRange.endDate && reqRange.endDate >= proRange.startDate) {
                const overlapStart =
                    reqRange.startDate > proRange.startDate ? reqRange.startDate : proRange.startDate;
                const overlapEnd =
                    reqRange.endDate < proRange.endDate ? reqRange.endDate : proRange.endDate;
                conflicts.push(`${overlapStart} → ${overlapEnd}`);
            }
        }
    }

    const handleAddRequiredRange = () => {
        setRestrictionWarning(null);
        if (!newReqRangeStart || !newReqRangeEnd) return;
        if (newReqRangeStart > newReqRangeEnd) {
            setRestrictionWarning('Required PTO range Start Date must be on or before End Date.');
            return;
        }
        const conflictingPro = rules.restrictions.prohibitedDateRanges.find(
            r => r.startDate <= newReqRangeEnd && r.endDate >= newReqRangeStart
        );
        if (conflictingPro) {
            setRestrictionWarning(
                `Conflict: Required PTO range [${newReqRangeStart} to ${newReqRangeEnd}] overlaps Prohibited range [${conflictingPro.startDate} to ${conflictingPro.endDate}].`
            );
            return;
        }

        // Verify that the range contains at least one eligible working day
        let hasWorkingDay = false;
        const [sy, sm, sd] = newReqRangeStart.split('-').map(Number);
        const [ey, em, ed] = newReqRangeEnd.split('-').map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        for (let t = startMs; t <= endMs; t += 24 * 60 * 60 * 1000) {
            const d = new Date(t);
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            const dStr = `${y}-${m}-${day}`;
            if (!isWeekendOrHoliday(dStr)) {
                hasWorkingDay = true;
                break;
            }
        }
        if (!hasWorkingDay) {
            setRestrictionWarning(
                `Required PTO range [${newReqRangeStart} to ${newReqRangeEnd}] contains only weekends or public holidays. Only eligible working days consume PTO.`
            );
            return;
        }

        setRules(prev => ({
            ...prev,
            restrictions: {
                ...prev.restrictions,
                requiredDateRanges: [
                    ...(prev.restrictions.requiredDateRanges ?? []),
                    {
                        id: `req_${newReqRangeStart}_${newReqRangeEnd}_${Date.now()}`,
                        startDate: newReqRangeStart,
                        endDate: newReqRangeEnd,
                        label: newReqRangeLabel.trim() || undefined
                    }
                ]
            }
        }));
        setNewReqRangeStart('');
        setNewReqRangeEnd('');
        setNewReqRangeLabel('');
    };

    const handleAddProhibitedRange = () => {
        setRestrictionWarning(null);
        if (!newRangeStart || !newRangeEnd) return;
        if (newRangeStart > newRangeEnd) {
            setRestrictionWarning('Prohibited range Start Date must be on or before End Date.');
            return;
        }
        const conflictingReq = rules.restrictions.requiredPTODates.find(
            d => d >= newRangeStart && d <= newRangeEnd
        );
        if (conflictingReq) {
            setRestrictionWarning(
                `Conflict: Prohibited range [${newRangeStart} to ${newRangeEnd}] overlaps Required PTO date ${conflictingReq}.`
            );
            return;
        }
        const conflictingReqRange = requiredDateRanges.find(
            r => r.startDate <= newRangeEnd && r.endDate >= newRangeStart
        );
        if (conflictingReqRange) {
            setRestrictionWarning(
                `Conflict: Prohibited range [${newRangeStart} to ${newRangeEnd}] overlaps Required PTO range [${conflictingReqRange.startDate} to ${conflictingReqRange.endDate}].`
            );
            return;
        }
        setRules(prev => ({
            ...prev,
            restrictions: {
                ...prev.restrictions,
                prohibitedDateRanges: [
                    ...prev.restrictions.prohibitedDateRanges,
                    {
                        id: `${newRangeStart}_${newRangeEnd}_${Date.now()}`,
                        startDate: newRangeStart,
                        endDate: newRangeEnd,
                        label: newRangeLabel.trim() || undefined
                    }
                ]
            }
        }));
        setNewRangeStart('');
        setNewRangeEnd('');
        setNewRangeLabel('');
    };

    return (
        <div className="mt-6 space-y-6">
            {/* Prominent, always-visible D. Date Restrictions Widget (replaces Manual PTO) */}
            <div className="p-5 md:p-6 rounded-2xl bg-gradient-to-br from-emerald-500/10 via-indigo-500/5 to-rose-500/10 border-2 border-indigo-500/30 shadow-md space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm md:text-base font-extrabold text-indigo-700 dark:text-indigo-300 uppercase tracking-wider">
                                D. Date Restrictions (Eligible Working Days Only)
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                                Lock Required PTO or Block Prohibited Ranges
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                            Add mandatory PTO date ranges you want to lock in, or prohibited date ranges where PTO cannot be allocated. Weekends and Singapore public holidays never consume PTO.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            {requiredDateRanges.length} Required Range(s)
                        </span>
                        <span className="px-2.5 py-1 rounded-lg bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/30">
                            {rules.restrictions.prohibitedDateRanges.length} Prohibited Range(s)
                        </span>
                    </div>
                </div>

                {(restrictionWarning || conflicts.length > 0) && (
                    <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <div>
                            {restrictionWarning && <p>{restrictionWarning}</p>}
                            {conflicts.length > 0 && (
                                <p className="font-semibold">
                                    Conflict detected on date(s): {conflicts.join(', ')} (marked as both Required and Prohibited).
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* 1. Required PTO Date Ranges (Mandatory) */}
                    <div className="p-4 rounded-xl bg-white/75 dark:bg-black/30 border-2 border-emerald-500/30 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs md:text-sm font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                                <CheckCircle2 className="w-4 h-4 shrink-0" />
                                1. Required PTO Date Ranges (Mandatory)
                            </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                                    Start Date
                                </span>
                                <input
                                    type="date"
                                    min={startDate}
                                    max={endDate}
                                    value={newReqRangeStart}
                                    onChange={e => setNewReqRangeStart(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                                />
                            </div>
                            <div>
                                <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                                    End Date
                                </span>
                                <input
                                    type="date"
                                    min={newReqRangeStart || startDate}
                                    max={endDate}
                                    value={newReqRangeEnd}
                                    onChange={e => setNewReqRangeEnd(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-emerald-500/30 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Optional label (e.g. Family Trip)"
                                value={newReqRangeLabel}
                                onChange={e => setNewReqRangeLabel(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-xs"
                            />
                            <button
                                type="button"
                                onClick={handleAddRequiredRange}
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 inline-flex items-center gap-1 shadow-sm"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Required
                            </button>
                        </div>
                        <div className="space-y-1.5 pt-1">
                            {requiredDateRanges.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground">
                                    No required PTO ranges added yet. Select a start and end date above to lock in mandatory PTO.
                                </span>
                            ) : (
                                requiredDateRanges.map(r => (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs font-medium text-emerald-800 dark:text-emerald-200"
                                    >
                                        <span className="inline-flex items-center gap-1.5">
                                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                            <span>
                                                {r.startDate} → {r.endDate}
                                                {r.label ? ` (${r.label})` : ''}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setRules(prev => ({
                                                    ...prev,
                                                    restrictions: {
                                                        ...prev.restrictions,
                                                        requiredDateRanges: (
                                                            prev.restrictions.requiredDateRanges ?? []
                                                        ).filter(x => x.id !== r.id)
                                                    }
                                                }))
                                            }
                                            className="text-red-500 hover:text-red-400"
                                            title="Remove required range"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* 2. Prohibited Date Ranges (No PTO) */}
                    <div className="p-4 rounded-xl bg-white/75 dark:bg-black/30 border-2 border-red-500/30 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                            <label className="text-xs md:text-sm font-bold text-red-700 dark:text-red-300 flex items-center gap-1.5">
                                <CalendarOff className="w-4 h-4 shrink-0" />
                                2. Prohibited Date Ranges (No PTO)
                            </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                                    Start Date
                                </span>
                                <input
                                    type="date"
                                    min={startDate}
                                    max={endDate}
                                    value={newRangeStart}
                                    onChange={e => setNewRangeStart(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-red-500/30 focus:outline-none focus:ring-2 focus:ring-red-500 text-xs"
                                />
                            </div>
                            <div>
                                <span className="block text-[11px] font-medium text-muted-foreground mb-1">
                                    End Date
                                </span>
                                <input
                                    type="date"
                                    min={newRangeStart || startDate}
                                    max={endDate}
                                    value={newRangeEnd}
                                    onChange={e => setNewRangeEnd(e.target.value)}
                                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-red-500/30 focus:outline-none focus:ring-2 focus:ring-red-500 text-xs"
                                />
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Optional label (e.g. Q3 Freeze)"
                                value={newRangeLabel}
                                onChange={e => setNewRangeLabel(e.target.value)}
                                className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-xs"
                            />
                            <button
                                type="button"
                                onClick={handleAddProhibitedRange}
                                className="px-3.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-500 inline-flex items-center gap-1 shadow-sm"
                            >
                                <Plus className="w-3.5 h-3.5" /> Add Prohibited
                            </button>
                        </div>
                        <div className="space-y-1.5 pt-1">
                            {rules.restrictions.prohibitedDateRanges.length === 0 ? (
                                <span className="text-[11px] text-muted-foreground">
                                    No prohibited ranges added yet. Select a start and end date above to block PTO allocation.
                                </span>
                            ) : (
                                rules.restrictions.prohibitedDateRanges.map(r => (
                                    <div
                                        key={r.id}
                                        className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-xs font-medium text-red-800 dark:text-red-200"
                                    >
                                        <span className="inline-flex items-center gap-1.5">
                                            <CalendarOff className="w-3.5 h-3.5 shrink-0" />
                                            <span>
                                                {r.startDate} → {r.endDate}
                                                {r.label ? ` (${r.label})` : ''}
                                            </span>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() =>
                                                setRules(prev => ({
                                                    ...prev,
                                                    restrictions: {
                                                        ...prev.restrictions,
                                                        prohibitedDateRanges:
                                                            prev.restrictions.prohibitedDateRanges.filter(
                                                                x => x.id !== r.id
                                                            )
                                                    }
                                                }))
                                            }
                                            className="text-red-500 hover:text-red-400"
                                            title="Remove prohibited range"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Singapore NS In-Camp Training (ICT) Configuration Section */}
            <div className="p-5 md:p-6 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-sky-500/5 to-transparent border-2 border-cyan-500/30 shadow-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 mt-0.5">
                            <Shield className="w-4 h-4" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="text-sm md:text-base font-extrabold text-cyan-800 dark:text-cyan-300 uppercase tracking-wider">
                                    Singapore NS In-Camp Training (ICT) Allocation
                                </h3>
                                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 border border-cyan-500/30">
                                    Separate Quota • Calendar Days
                                </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                                ICT periods count as time away from work and contribute to continuous breaks without consuming annual PTO.
                            </p>
                        </div>
                    </div>

                    <label className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-white/80 dark:bg-black/40 border border-cyan-500/40 cursor-pointer font-bold text-xs md:text-sm text-cyan-800 dark:text-cyan-200 shadow-sm">
                        <input
                            type="checkbox"
                            checked={ictRules.enabled}
                            onChange={e =>
                                setRules(prev => ({
                                    ...prev,
                                    ict: {
                                        ...prev.ict,
                                        enabled: e.target.checked
                                    }
                                }))
                            }
                            className="rounded text-cyan-600 focus:ring-cyan-500"
                        />
                        <span>Enable ICT allocation</span>
                    </label>
                </div>

                {ictRules.enabled && (
                    <div className="pt-3 border-t border-cyan-500/20 space-y-6 text-xs">
                        {/* A. ICT Quota & Enablement Controls */}
                        <div className="space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h4 className="font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider">
                                    A. ICT Quota & Policy
                                </h4>
                                <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 font-semibold border border-cyan-500/30">
                                    Available ICT Quota: {availableICTQuota} calendar days ({ictRules.annualICTQuota} quota − {ictRules.reserveICTDays} reserved)
                                </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Annual ICT quota (calendar days)
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={180}
                                        value={ictRules.annualICTQuota}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    annualICTQuota: Math.max(0, Number(e.target.value))
                                                }
                                            }))
                                        }
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Minimum ICT days to allocate
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={availableICTQuota}
                                        value={ictRules.minICTDaysToAllocate}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    minICTDaysToAllocate: Math.max(
                                                        0,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Reserve ICT days
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={ictRules.annualICTQuota}
                                        value={ictRules.reserveICTDays}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    reserveICTDays: Math.max(0, Number(e.target.value))
                                                }
                                            }))
                                        }
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="flex items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={ictRules.allowUnusedICTQuota}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    allowUnusedICTQuota: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-cyan-600"
                                    />
                                    <span className="font-medium">Allow unused ICT quota</span>
                                </label>

                                <label className="flex items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={ictRules.allowMultipleICTPeriods}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    allowMultipleICTPeriods: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-cyan-600"
                                    />
                                    <span className="font-medium">Allow multiple ICT periods</span>
                                </label>
                            </div>
                        </div>

                        {/* B. ICT Period Configuration */}
                        <div className="space-y-3">
                            <h4 className="font-bold text-cyan-700 dark:text-cyan-300 uppercase tracking-wider">
                                B. ICT Period Configuration & Spacing
                            </h4>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Min period duration (days)
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={60}
                                        value={ictRules.minPeriodDuration}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    minPeriodDuration: Math.max(
                                                        1,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Max period duration (days)
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={90}
                                        placeholder="Unlimited"
                                        value={ictRules.maxPeriodDuration ?? ''}
                                        onChange={e => {
                                            const v = e.target.value.trim();
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    maxPeriodDuration:
                                                        v === '' ? null : Math.max(1, Number(v))
                                                }
                                            }));
                                        }}
                                        className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Min separate ICT periods
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={20}
                                        value={ictRules.minNumberOfICTPeriods}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    minNumberOfICTPeriods: Math.max(
                                                        0,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Max separate ICT periods
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={20}
                                        placeholder="Unlimited"
                                        disabled={!ictRules.allowMultipleICTPeriods}
                                        value={
                                            !ictRules.allowMultipleICTPeriods
                                                ? 1
                                                : ictRules.maxNumberOfICTPeriods ?? ''
                                        }
                                        onChange={e => {
                                            const v = e.target.value.trim();
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    maxNumberOfICTPeriods:
                                                        v === '' ? null : Math.max(1, Number(v))
                                                }
                                            }));
                                        }}
                                        className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15">
                                    <label className="block font-semibold mb-1">
                                        Min calendar days between ICTs
                                    </label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={180}
                                        value={ictRules.minCalendarDaysBetweenICTPeriods}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                ict: {
                                                    ...prev.ict,
                                                    minCalendarDaysBetweenICTPeriods: Math.max(
                                                        1,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 p-3 rounded-xl bg-white/60 dark:bg-black/25 border border-white/15 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={ictRules.distributeICTThroughoutYear}
                                    onChange={e =>
                                        setRules(prev => ({
                                            ...prev,
                                            ict: {
                                                ...prev.ict,
                                                distributeICTThroughoutYear: e.target.checked
                                            }
                                        }))
                                    }
                                    className="rounded text-cyan-600"
                                />
                                <span className="font-medium">
                                    Allow ICT periods to be distributed throughout the year
                                </span>
                            </label>
                        </div>

                        {/* Manually Specified Fixed ICT Date Ranges */}
                        <div className="p-4 rounded-xl bg-white/75 dark:bg-black/30 border border-cyan-500/30 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h5 className="font-bold text-cyan-800 dark:text-cyan-200">
                                        Manually Specified ICT Periods (Optional Fixed Absences)
                                    </h5>
                                    <p className="text-[11px] text-muted-foreground">
                                        Specify fixed ICT recall periods, or leave empty to let the optimizer automatically allocate suitable ICT periods.
                                    </p>
                                </div>
                                <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">
                                    Fixed ICT: {fixedICTDaysConsumed} / {availableICTQuota} calendar days ({ictRules.fixedICTPeriods.length} period(s))
                                </span>
                            </div>

                            {ictWarning && (
                                <div className="p-2.5 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-200 flex items-center gap-2">
                                    <AlertTriangle className="w-4 h-4 shrink-0" />
                                    <span>{ictWarning}</span>
                                </div>
                            )}

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
                                <div>
                                    <span className="block text-[11px] text-muted-foreground mb-1">
                                        ICT Start Date
                                    </span>
                                    <input
                                        type="date"
                                        min={startDate}
                                        max={endDate}
                                        value={newICTStart}
                                        onChange={e => setNewICTStart(e.target.value)}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-cyan-500/30 text-xs"
                                    />
                                </div>
                                <div>
                                    <span className="block text-[11px] text-muted-foreground mb-1">
                                        ICT End Date
                                        {newICTStart &&
                                            newICTEnd &&
                                            newICTStart <= newICTEnd &&
                                            ` (${diffCalendarDays(newICTStart, newICTEnd) + 1} calendar days)`}
                                    </span>
                                    <input
                                        type="date"
                                        min={newICTStart || startDate}
                                        max={endDate}
                                        value={newICTEnd}
                                        onChange={e => setNewICTEnd(e.target.value)}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-cyan-500/30 text-xs"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Label (e.g. High Key ICT)"
                                        value={newICTLabel}
                                        onChange={e => setNewICTLabel(e.target.value)}
                                        className="flex-1 px-2.5 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-xs"
                                    />
                                    <button
                                        type="button"
                                        onClick={handleAddFixedICTPeriod}
                                        className="px-3 py-1.5 rounded-lg bg-cyan-600 text-white text-xs font-bold hover:bg-cyan-500 inline-flex items-center gap-1 shrink-0"
                                    >
                                        <Plus className="w-3.5 h-3.5" /> Add ICT
                                    </button>
                                </div>
                            </div>

                            {ictRules.fixedICTPeriods.length > 0 && (
                                <div className="space-y-1.5 pt-2">
                                    {ictRules.fixedICTPeriods.map((p, idx) => {
                                        const calDays =
                                            p.startDate <= p.endDate
                                                ? diffCalendarDays(p.startDate, p.endDate) + 1
                                                : 0;
                                        const isEditing = editingICTId === p.id;
                                        return (
                                            <div
                                                key={p.id}
                                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30"
                                            >
                                                {isEditing ? (
                                                    <div className="flex flex-wrap items-center gap-2 flex-1">
                                                        <input
                                                            type="date"
                                                            min={startDate}
                                                            max={endDate}
                                                            value={editICTStart}
                                                            onChange={e =>
                                                                setEditICTStart(e.target.value)
                                                            }
                                                            className="px-2 py-1 rounded bg-white dark:bg-black/40 border border-cyan-500/40 text-xs"
                                                        />
                                                        <span>→</span>
                                                        <input
                                                            type="date"
                                                            min={editICTStart || startDate}
                                                            max={endDate}
                                                            value={editICTEnd}
                                                            onChange={e =>
                                                                setEditICTEnd(e.target.value)
                                                            }
                                                            className="px-2 py-1 rounded bg-white dark:bg-black/40 border border-cyan-500/40 text-xs"
                                                        />
                                                        <input
                                                            type="text"
                                                            placeholder="Label"
                                                            value={editICTLabel}
                                                            onChange={e =>
                                                                setEditICTLabel(e.target.value)
                                                            }
                                                            className="px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-xs"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() =>
                                                                handleSaveEditICTPeriod(p.id)
                                                            }
                                                            className="px-2.5 py-1 rounded bg-cyan-600 text-white text-xs font-bold"
                                                        >
                                                            Save
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => setEditingICTId(null)}
                                                            className="px-2 py-1 rounded bg-neutral-200 dark:bg-white/10 text-xs"
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-cyan-800 dark:text-cyan-200">
                                                                ICT {idx + 1}:
                                                            </span>
                                                            <span className="font-medium">
                                                                {p.startDate} → {p.endDate}
                                                                {p.label ? ` (${p.label})` : ''}
                                                            </span>
                                                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-cyan-600 text-white">
                                                                {calDays} calendar days
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setEditingICTId(p.id);
                                                                    setEditICTStart(p.startDate);
                                                                    setEditICTEnd(p.endDate);
                                                                    setEditICTLabel(p.label ?? '');
                                                                }}
                                                                className="text-cyan-700 dark:text-cyan-300 hover:underline inline-flex items-center gap-1"
                                                                title="Edit ICT period"
                                                            >
                                                                <Edit2 className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    setRules(prev => ({
                                                                        ...prev,
                                                                        ict: {
                                                                            ...prev.ict,
                                                                            fixedICTPeriods:
                                                                                prev.ict.fixedICTPeriods.filter(
                                                                                    x => x.id !== p.id
                                                                                )
                                                                        }
                                                                    }))
                                                                }
                                                                className="text-red-500 hover:text-red-400"
                                                                title="Remove ICT period"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            <div className="rounded-2xl bg-white/60 dark:bg-white/5 border border-indigo-500/20 overflow-hidden transition-all">
                <button
                    type="button"
                    onClick={() => setIsOpen(o => !o)}
                    className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-indigo-500/5 transition-colors"
                >
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                            <Sliders className="w-4 h-4" />
                        </div>
                        <div>
                            <h3 className="text-sm md:text-base font-bold">
                                Optimization Rules & Preferences
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                Shared rules across all selected algorithms • Available PTO:{' '}
                                <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                    {availablePTO} days
                                </span>{' '}
                                ({duration} allowance − {rules.allocation.reservePTODays} reserved)
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                            {isOpen ? 'Hide Rules' : 'Customize Rules'}
                        </span>
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                </button>

                {isOpen && (
                    <div className="p-5 border-t border-white/10 space-y-8 text-sm">
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={resetRules}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-200/70 dark:bg-white/10 hover:bg-neutral-300/70 dark:hover:bg-white/20 transition-colors"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Reset Shared Rules to Defaults
                            </button>
                        </div>

                        {/* A. PTO Allocation Rules */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-xs">
                                A. PTO Allocation Rules
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Minimum PTO to allocate
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={availablePTO}
                                        value={rules.allocation.minPTOToAllocate}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                allocation: {
                                                    ...prev.allocation,
                                                    minPTOToAllocate: Math.max(0, Number(e.target.value))
                                                }
                                            }))
                                        }
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Reserve PTO days (withheld)
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={duration}
                                        value={rules.allocation.reservePTODays}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                allocation: {
                                                    ...prev.allocation,
                                                    reservePTODays: Math.max(0, Number(e.target.value))
                                                }
                                            }))
                                        }
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                    <span className="text-[11px] text-muted-foreground">
                                        Available for optimization: {availablePTO} days
                                    </span>
                                </div>

                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Max consecutive PTO working days
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={1}
                                            max={30}
                                            placeholder="Unlimited"
                                            value={rules.allocation.maxConsecutivePTOWorkingDays ?? ''}
                                            onChange={e => {
                                                const val = e.target.value.trim();
                                                setRules(prev => ({
                                                    ...prev,
                                                    allocation: {
                                                        ...prev.allocation,
                                                        maxConsecutivePTOWorkingDays:
                                                            val === '' ? null : Math.max(1, Number(val))
                                                    }
                                                }));
                                            }}
                                            className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                        />
                                        {rules.allocation.maxConsecutivePTOWorkingDays !== null && (
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setRules(prev => ({
                                                        ...prev,
                                                        allocation: {
                                                            ...prev.allocation,
                                                            maxConsecutivePTOWorkingDays: null
                                                        }
                                                    }))
                                                }
                                                className="text-xs text-indigo-500 hover:underline whitespace-nowrap"
                                            >
                                                Unlimited
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <label className="flex items-center gap-2 p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={rules.allocation.allowUnusedPTO}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                allocation: {
                                                    ...prev.allocation,
                                                    allowUnusedPTO: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-indigo-600"
                                    />
                                    <span className="text-xs font-medium">Allow unused PTO</span>
                                </label>

                                <label className="flex items-center gap-2 p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={rules.allocation.allowPTOAdjacentToHolidays}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                allocation: {
                                                    ...prev.allocation,
                                                    allowPTOAdjacentToHolidays: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-indigo-600"
                                    />
                                    <span className="text-xs font-medium">
                                        Allow PTO adjacent to public holidays
                                    </span>
                                </label>

                                <label className="flex items-center gap-2 p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={rules.allocation.allowPTOAdjacentToWeekends}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                allocation: {
                                                    ...prev.allocation,
                                                    allowPTOAdjacentToWeekends: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-indigo-600"
                                    />
                                    <span className="text-xs font-medium">
                                        Allow PTO adjacent to weekends
                                    </span>
                                </label>
                            </div>
                        </div>

                        {/* B. Break Duration Rules */}
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <h4 className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-xs">
                                        B. Break Duration Rules
                                    </h4>
                                    <p className="text-xs text-muted-foreground">
                                        Durations use consecutive calendar days (including weekends & Singapore public holidays).
                                    </p>
                                </div>
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={rules.breakDuration.allowOverlappingCategoryCounts}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                breakDuration: {
                                                    ...prev.breakDuration,
                                                    allowOverlappingCategoryCounts: e.target.checked
                                                }
                                            }))
                                        }
                                        className="rounded text-indigo-600"
                                    />
                                    <span>Allow overlapping category counts</span>
                                </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                                {BREAK_CATEGORIES.map(({ key, label }) => {
                                    const catRule = rules.breakDuration[key];
                                    return (
                                        <div
                                            key={key}
                                            className={`p-3 rounded-xl border transition-opacity ${catRule.enabled
                                                ? 'bg-white/50 dark:bg-black/20 border-indigo-500/20'
                                                : 'bg-neutral-100/40 dark:bg-white/5 border-white/5 opacity-60'
                                                }`}
                                        >
                                            <label className="flex items-center justify-between font-semibold text-xs mb-2 cursor-pointer">
                                                <span>{label}</span>
                                                <input
                                                    type="checkbox"
                                                    checked={catRule.enabled}
                                                    onChange={e => {
                                                        const nextEnabled = e.target.checked;
                                                        setRules(prev => ({
                                                            ...prev,
                                                            breakDuration: {
                                                                ...prev.breakDuration,
                                                                [key]: {
                                                                    ...prev.breakDuration[key],
                                                                    enabled: nextEnabled,
                                                                    minCount: nextEnabled
                                                                        ? Math.max(
                                                                            1,
                                                                            prev.breakDuration[key]
                                                                                .minCount || 1
                                                                        )
                                                                        : 0
                                                                }
                                                            }
                                                        }));
                                                    }}
                                                    className="rounded text-indigo-600"
                                                />
                                            </label>

                                            <div className="space-y-2 text-xs">
                                                <div>
                                                    <span className="text-muted-foreground block">
                                                        Min duration (calendar days)
                                                    </span>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        max={60}
                                                        disabled={!catRule.enabled}
                                                        value={catRule.minDuration}
                                                        onChange={e =>
                                                            setRules(prev => ({
                                                                ...prev,
                                                                breakDuration: {
                                                                    ...prev.breakDuration,
                                                                    [key]: {
                                                                        ...prev.breakDuration[key],
                                                                        minDuration: Math.max(
                                                                            1,
                                                                            Number(e.target.value)
                                                                        )
                                                                    }
                                                                }
                                                            }))
                                                        }
                                                        className="w-full mt-0.5 px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                                    />
                                                </div>

                                                <div className="grid grid-cols-2 gap-2">
                                                    <div>
                                                        <span className="text-muted-foreground block">
                                                            Min breaks
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={30}
                                                            disabled={!catRule.enabled}
                                                            value={catRule.minCount}
                                                            onChange={e =>
                                                                setRules(prev => ({
                                                                    ...prev,
                                                                    breakDuration: {
                                                                        ...prev.breakDuration,
                                                                        [key]: {
                                                                            ...prev.breakDuration[key],
                                                                            minCount: Math.max(
                                                                                0,
                                                                                Number(e.target.value)
                                                                            )
                                                                        }
                                                                    }
                                                                }))
                                                            }
                                                            className="w-full mt-0.5 px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                                        />
                                                    </div>
                                                    <div>
                                                        <span className="text-muted-foreground block">
                                                            Max breaks
                                                        </span>
                                                        <input
                                                            type="number"
                                                            min={0}
                                                            max={50}
                                                            placeholder="∞"
                                                            disabled={!catRule.enabled}
                                                            value={catRule.maxCount ?? ''}
                                                            onChange={e => {
                                                                const v = e.target.value.trim();
                                                                setRules(prev => ({
                                                                    ...prev,
                                                                    breakDuration: {
                                                                        ...prev.breakDuration,
                                                                        [key]: {
                                                                            ...prev.breakDuration[key],
                                                                            maxCount:
                                                                                v === ''
                                                                                    ? null
                                                                                    : Math.max(
                                                                                        0,
                                                                                        Number(v)
                                                                                    )
                                                                        }
                                                                    }
                                                                }));
                                                            }}
                                                            className="w-full mt-0.5 px-2 py-1 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* C. Break Distribution Rules */}
                        <div className="space-y-4">
                            <div>
                                <h4 className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-xs">
                                    C. Break Distribution Rules
                                </h4>
                                <p className="text-xs text-muted-foreground">
                                    Spacing is measured strictly from the <strong>end date of one break</strong> to the{' '}
                                    <strong>beginning date of the next break</strong>.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Min working days between breaks
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={120}
                                        value={rules.distribution.minWorkingDaysBetweenBreaks}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                distribution: {
                                                    ...prev.distribution,
                                                    minWorkingDaysBetweenBreaks: Math.max(
                                                        0,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Min calendar days between breaks
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={180}
                                        placeholder="Disabled"
                                        value={rules.distribution.minCalendarDaysBetweenBreaks ?? ''}
                                        onChange={e => {
                                            const v = e.target.value.trim();
                                            setRules(prev => ({
                                                ...prev,
                                                distribution: {
                                                    ...prev.distribution,
                                                    minCalendarDaysBetweenBreaks:
                                                        v === '' ? null : Math.max(0, Number(v))
                                                }
                                            }));
                                        }}
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Minimum number of breaks
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={30}
                                        value={rules.distribution.minNumberOfBreaks}
                                        onChange={e =>
                                            setRules(prev => ({
                                                ...prev,
                                                distribution: {
                                                    ...prev.distribution,
                                                    minNumberOfBreaks: Math.max(
                                                        0,
                                                        Number(e.target.value)
                                                    )
                                                }
                                            }))
                                        }
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>

                                <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                    <label className="block text-xs font-semibold mb-1">
                                        Maximum number of breaks
                                    </label>
                                    <input
                                        type="number"
                                        min={0}
                                        max={50}
                                        placeholder="Unlimited"
                                        value={rules.distribution.maxNumberOfBreaks ?? ''}
                                        onChange={e => {
                                            const v = e.target.value.trim();
                                            setRules(prev => ({
                                                ...prev,
                                                distribution: {
                                                    ...prev.distribution,
                                                    maxNumberOfBreaks:
                                                        v === '' ? null : Math.max(0, Number(v))
                                                }
                                            }));
                                        }}
                                        className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-sm"
                                    />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={rules.distribution.evenlyDistributeBreaks}
                                    onChange={e =>
                                        setRules(prev => ({
                                            ...prev,
                                            distribution: {
                                                ...prev.distribution,
                                                evenlyDistributeBreaks: e.target.checked
                                            }
                                        }))
                                    }
                                    className="rounded text-indigo-600"
                                />
                                <span className="text-xs font-medium">
                                    Evenly distribute breaks throughout date range
                                </span>
                            </label>
                        </div>

                        {/* D. Optimization Objectives */}
                        <div className="space-y-4">
                            <h4 className="font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider text-xs">
                                D. Optimization Objectives
                            </h4>

                            <div className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10">
                                <label className="block text-xs font-semibold mb-1.5">
                                    Primary Objective
                                </label>
                                <select
                                    value={rules.objectives.primary}
                                    onChange={e =>
                                        setRules(prev => ({
                                            ...prev,
                                            objectives: {
                                                ...prev.objectives,
                                                primary: e.target.value as PrimaryObjective
                                            }
                                        }))
                                    }
                                    className="w-full px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-neutral-300 dark:border-white/20 text-sm font-medium"
                                >
                                    {PRIMARY_OBJECTIVE_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-semibold mb-2">
                                    Secondary Objectives & Weights (Lexicographic / Weighted Tie-Breaking)
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {SECONDARY_OBJECTIVE_LABELS.map(({ key, label }) => {
                                        const secCfg = rules.objectives.secondaries[key];
                                        return (
                                            <div
                                                key={key}
                                                className="p-3 rounded-xl bg-white/50 dark:bg-black/20 border border-white/10 flex items-center justify-between gap-2"
                                            >
                                                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={secCfg.enabled}
                                                        onChange={e =>
                                                            setRules(prev => ({
                                                                ...prev,
                                                                objectives: {
                                                                    ...prev.objectives,
                                                                    secondaries: {
                                                                        ...prev.objectives.secondaries,
                                                                        [key]: {
                                                                            ...prev.objectives
                                                                                .secondaries[key],
                                                                            enabled: e.target.checked
                                                                        }
                                                                    }
                                                                }
                                                            }))
                                                        }
                                                        className="rounded text-indigo-600"
                                                    />
                                                    <span>{label}</span>
                                                </label>
                                                {secCfg.enabled && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-muted-foreground">
                                                            W:
                                                        </span>
                                                        <input
                                                            type="number"
                                                            step="0.5"
                                                            min={0.1}
                                                            max={10}
                                                            value={secCfg.weight}
                                                            onChange={e =>
                                                                setRules(prev => ({
                                                                    ...prev,
                                                                    objectives: {
                                                                        ...prev.objectives,
                                                                        secondaries: {
                                                                            ...prev.objectives
                                                                                .secondaries,
                                                                            [key]: {
                                                                                ...prev.objectives
                                                                                    .secondaries[key],
                                                                                weight: Math.max(
                                                                                    0.1,
                                                                                    Number(
                                                                                        e.target.value
                                                                                    )
                                                                                )
                                                                            }
                                                                        }
                                                                    }
                                                                }))
                                                            }
                                                            className="w-14 px-1.5 py-0.5 rounded bg-white dark:bg-black/40 border border-neutral-300 dark:border-white/20 text-xs text-right"
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
