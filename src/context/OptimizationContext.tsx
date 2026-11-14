import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode
} from 'react';
import {
    PUBLIC_HOLIDAYS_2027,
    computeSharedConfigSignature,
    createDefaultAlgorithmConfigs,
    createDefaultRules,
    runAlgorithmById,
    type AlgorithmConfigs,
    type AlgorithmId,
    type OptimizationProgress,
    type OptimizationResult,
    type SharedOptimizationInput,
    type SharedOptimizationRules
} from '@/core';

export type AppRoute =
    | '/'
    | '/algorithms/ilp'
    | '/algorithms/cpsat'
    | '/algorithms/dp'
    | '/algorithms/greedy'
    | '/algorithms/genetic'
    | '/algorithms/compare';

const STORAGE_KEY = 'sg_ph_optimizer_2027_state_v2';

interface PersistedState {
    startDate: string;
    endDate: string;
    duration: number;
    includeWeekends: boolean;
    manualPTODates: string[];
    selectedAlgorithms: Record<AlgorithmId, boolean>;
    rules: SharedOptimizationRules;
    algorithmConfigs: AlgorithmConfigs;
}

interface OptimizationContextValue {
    // Existing calendar controls
    startDate: string;
    setStartDate: (date: string) => void;
    endDate: string;
    setEndDate: (date: string) => void;
    duration: number;
    setDuration: (days: number) => void;
    includeWeekends: boolean;
    setIncludeWeekends: (inc: boolean) => void;
    manualPTODates: Set<string>;
    toggleManualPTODate: (dateStr: string) => void;
    clearManualPTODates: () => void;

    // Algorithm selection
    selectedAlgorithms: Record<AlgorithmId, boolean>;
    toggleAlgorithm: (id: AlgorithmId) => void;
    setAlgorithmSelected: (id: AlgorithmId, selected: boolean) => void;
    selectedAlgorithmIds: AlgorithmId[];

    // Shared rules & algorithm configs
    rules: SharedOptimizationRules;
    setRules: (updater: SharedOptimizationRules | ((prev: SharedOptimizationRules) => SharedOptimizationRules)) => void;
    resetRules: () => void;
    algorithmConfigs: AlgorithmConfigs;
    updateAlgorithmConfig: <K extends AlgorithmId>(
        id: K,
        patch: Partial<AlgorithmConfigs[K]>
    ) => void;
    resetAlgorithmConfig: (id: AlgorithmId) => void;

    // Shared input & staleness tracking
    sharedInput: SharedOptimizationInput;
    currentConfigSignature: string;
    isResultStale: (id: AlgorithmId) => boolean;
    hasAnyStaleResults: boolean;

    // Execution & Results
    results: Partial<Record<AlgorithmId, OptimizationResult>>;
    progressMap: Partial<Record<AlgorithmId, OptimizationProgress>>;
    isRunning: boolean;
    runningAlgorithms: Record<AlgorithmId, boolean>;
    runSelectedAlgorithms: () => Promise<void>;
    runSingleAlgorithm: (id: AlgorithmId) => Promise<OptimizationResult | undefined>;
    cancelOptimization: () => void;
    clearResults: () => void;

    // Active visualization mode on the main calendar
    activeCalendarSource: 'legacy' | AlgorithmId;
    setActiveCalendarSource: (source: 'legacy' | AlgorithmId) => void;

    // Routing
    currentRoute: AppRoute;
    navigate: (route: AppRoute) => void;
}

const OptimizationContext = createContext<OptimizationContextValue | null>(null);

function parseRouteFromLocation(): AppRoute {
    if (typeof window === 'undefined') return '/';
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    let path = window.location.pathname;
    if (base && path.startsWith(base)) {
        path = path.slice(base.length) || '/';
    }
    const validRoutes: AppRoute[] = [
        '/',
        '/algorithms/ilp',
        '/algorithms/cpsat',
        '/algorithms/dp',
        '/algorithms/greedy',
        '/algorithms/genetic',
        '/algorithms/compare'
    ];
    if (validRoutes.includes(path as AppRoute)) {
        return path as AppRoute;
    }
    return '/';
}

function loadPersistedState(): Partial<PersistedState> | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as Partial<PersistedState>;
    } catch {
        return null;
    }
}

export function OptimizationProvider({ children }: { children: ReactNode }) {
    const saved = useMemo(() => loadPersistedState(), []);

    const [startDate, setStartDateState] = useState<string>(saved?.startDate ?? '2027-01-01');
    const [endDate, setEndDateState] = useState<string>(saved?.endDate ?? '2027-12-31');
    const [duration, setDurationState] = useState<number>(saved?.duration ?? 7);
    const [includeWeekends, setIncludeWeekends] = useState<boolean>(
        saved?.includeWeekends ?? true
    );
    const [manualPTODates, setManualPTODates] = useState<Set<string>>(
        () => new Set(saved?.manualPTODates ?? [])
    );

    const [selectedAlgorithms, setSelectedAlgorithms] = useState<Record<AlgorithmId, boolean>>(
        () =>
            saved?.selectedAlgorithms ?? {
                ilp: true,
                cpsat: false,
                dp: false,
                greedy: true,
                genetic: false
            }
    );

    const [rules, setRules] = useState<SharedOptimizationRules>(() => {
        const defaults = createDefaultRules();
        if (!saved?.rules) return defaults;
        return {
            allocation: { ...defaults.allocation, ...saved.rules.allocation },
            breakDuration: { ...defaults.breakDuration, ...saved.rules.breakDuration },
            distribution: { ...defaults.distribution, ...saved.rules.distribution },
            restrictions: { ...defaults.restrictions, ...saved.rules.restrictions },
            objectives: {
                primary: saved.rules.objectives?.primary ?? defaults.objectives.primary,
                secondaries: {
                    ...defaults.objectives.secondaries,
                    ...(saved.rules.objectives?.secondaries ?? {})
                }
            }
        };
    });

    const [algorithmConfigs, setAlgorithmConfigs] = useState<AlgorithmConfigs>(() => {
        const defaults = createDefaultAlgorithmConfigs();
        if (!saved?.algorithmConfigs) return defaults;
        return {
            ilp: { ...defaults.ilp, ...saved.algorithmConfigs.ilp },
            cpsat: { ...defaults.cpsat, ...saved.algorithmConfigs.cpsat },
            dp: { ...defaults.dp, ...saved.algorithmConfigs.dp },
            greedy: { ...defaults.greedy, ...saved.algorithmConfigs.greedy },
            genetic: { ...defaults.genetic, ...saved.algorithmConfigs.genetic }
        };
    });

    const [results, setResults] = useState<Partial<Record<AlgorithmId, OptimizationResult>>>({});
    const [progressMap, setProgressMap] = useState<
        Partial<Record<AlgorithmId, OptimizationProgress>>
    >({});
    const [runningAlgorithms, setRunningAlgorithms] = useState<Record<AlgorithmId, boolean>>({
        ilp: false,
        cpsat: false,
        dp: false,
        greedy: false,
        genetic: false
    });
    const [activeCalendarSource, setActiveCalendarSource] = useState<'legacy' | AlgorithmId>(
        'legacy'
    );
    const [currentRoute, setCurrentRoute] = useState<AppRoute>(() => parseRouteFromLocation());

    const abortControllerRef = useRef<AbortController | null>(null);

    // Sync route with browser back/forward buttons
    useEffect(() => {
        const onPopState = () => {
            setCurrentRoute(parseRouteFromLocation());
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    const navigate = useCallback((route: AppRoute) => {
        const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
        const targetPath = route === '/' ? `${base}/` : `${base}${route}`;
        window.history.pushState({}, '', targetPath);
        setCurrentRoute(route);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    // Persist configuration changes to localStorage
    useEffect(() => {
        try {
            const payload: PersistedState = {
                startDate,
                endDate,
                duration,
                includeWeekends,
                manualPTODates: Array.from(manualPTODates),
                selectedAlgorithms,
                rules,
                algorithmConfigs
            };
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        } catch {
            // Ignore storage quota errors
        }
    }, [
        startDate,
        endDate,
        duration,
        includeWeekends,
        manualPTODates,
        selectedAlgorithms,
        rules,
        algorithmConfigs
    ]);

    // Clear manual PTO dates outside [startDate, endDate]
    useEffect(() => {
        setManualPTODates(prev => {
            const next = new Set(prev);
            let changed = false;
            prev.forEach(d => {
                if (d < startDate || d > endDate) {
                    next.delete(d);
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [startDate, endDate]);

    const setStartDate = useCallback((date: string) => {
        if (!date) return;
        setStartDateState(date);
    }, []);

    const setEndDate = useCallback((date: string) => {
        if (!date) return;
        setEndDateState(date);
    }, []);

    const setDuration = useCallback((days: number) => {
        setDurationState(Math.max(0, Math.min(60, days)));
    }, []);

    const toggleManualPTODate = useCallback(
        (dateStr: string) => {
            const remaining = duration - manualPTODates.size;
            setManualPTODates(prev => {
                const next = new Set(prev);
                if (next.has(dateStr)) {
                    next.delete(dateStr);
                } else if (remaining > 0) {
                    next.add(dateStr);
                }
                return next;
            });
        },
        [duration, manualPTODates.size]
    );

    const clearManualPTODates = useCallback(() => {
        setManualPTODates(new Set());
    }, []);

    const toggleAlgorithm = useCallback((id: AlgorithmId) => {
        setSelectedAlgorithms(prev => ({ ...prev, [id]: !prev[id] }));
    }, []);

    const setAlgorithmSelected = useCallback((id: AlgorithmId, selected: boolean) => {
        setSelectedAlgorithms(prev => ({ ...prev, [id]: selected }));
    }, []);

    const selectedAlgorithmIds = useMemo(() => {
        const order: AlgorithmId[] = ['ilp', 'cpsat', 'dp', 'greedy', 'genetic'];
        return order.filter(id => selectedAlgorithms[id]);
    }, [selectedAlgorithms]);

    const resetRules = useCallback(() => {
        setRules(createDefaultRules());
    }, []);

    const updateAlgorithmConfig = useCallback(
        <K extends AlgorithmId>(id: K, patch: Partial<AlgorithmConfigs[K]>) => {
            setAlgorithmConfigs(prev => ({
                ...prev,
                [id]: { ...prev[id], ...patch }
            }));
        },
        []
    );

    const resetAlgorithmConfig = useCallback((id: AlgorithmId) => {
        const defaults = createDefaultAlgorithmConfigs();
        setAlgorithmConfigs(prev => ({
            ...prev,
            [id]: defaults[id]
        }));
    }, []);

    const sharedInput = useMemo<SharedOptimizationInput>(
        () => ({
            startDate,
            endDate,
            ptoAllowance: duration,
            publicHolidays: PUBLIC_HOLIDAYS_2027,
            rules
        }),
        [startDate, endDate, duration, rules]
    );

    const currentConfigSignature = useMemo(
        () => computeSharedConfigSignature(sharedInput),
        [sharedInput]
    );

    const isResultStale = useCallback(
        (id: AlgorithmId): boolean => {
            const res = results[id];
            if (!res) return false;
            return res.configSignature !== currentConfigSignature;
        },
        [results, currentConfigSignature]
    );

    const hasAnyStaleResults = useMemo(() => {
        return (['ilp', 'cpsat', 'dp', 'greedy', 'genetic'] as AlgorithmId[]).some(id =>
            isResultStale(id)
        );
    }, [isResultStale]);

    const isRunning = useMemo(
        () => Object.values(runningAlgorithms).some(Boolean),
        [runningAlgorithms]
    );

    const cancelOptimization = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setRunningAlgorithms({
            ilp: false,
            cpsat: false,
            dp: false,
            greedy: false,
            genetic: false
        });
    }, []);

    const clearResults = useCallback(() => {
        setResults({});
        setProgressMap({});
        setActiveCalendarSource('legacy');
    }, []);

    const runSingleAlgorithm = useCallback(
        async (id: AlgorithmId): Promise<OptimizationResult | undefined> => {
            const controller = new AbortController();
            abortControllerRef.current = controller;

            setRunningAlgorithms(prev => ({ ...prev, [id]: true }));
            setProgressMap(prev => ({
                ...prev,
                [id]: {
                    algorithmId: id,
                    phase: 'Starting optimization...',
                    percent: 5
                }
            }));

            try {
                const res = await runAlgorithmById(
                    id,
                    sharedInput,
                    algorithmConfigs,
                    prog => {
                        setProgressMap(prev => ({ ...prev, [id]: prog }));
                    },
                    controller.signal
                );

                setResults(prev => ({ ...prev, [id]: res }));
                setProgressMap(prev => ({
                    ...prev,
                    [id]: {
                        algorithmId: id,
                        phase: 'Complete',
                        percent: 100,
                        bestScore: res.primaryObjectiveScore,
                        statesExplored: res.statesExplored,
                        convergenceHistory: res.convergenceHistory
                    }
                }));

                if (res.validation.isValid && (res.status === 'optimal' || res.status === 'feasible')) {
                    setActiveCalendarSource(id);
                }

                return res;
            } finally {
                setRunningAlgorithms(prev => ({ ...prev, [id]: false }));
            }
        },
        [sharedInput, algorithmConfigs]
    );

    // Keep the active algorithm visualization synchronized when shared inputs (slider, dates, or prohibited ranges) change
    useEffect(() => {
        if (activeCalendarSource === 'legacy') return;
        if (!selectedAlgorithms[activeCalendarSource]) {
            setActiveCalendarSource('legacy');
            return;
        }
        const res = results[activeCalendarSource];
        if (!res || res.configSignature !== currentConfigSignature) {
            const timer = window.setTimeout(() => {
                void runSingleAlgorithm(activeCalendarSource);
            }, 150);
            return () => window.clearTimeout(timer);
        }
    }, [
        activeCalendarSource,
        selectedAlgorithms,
        results,
        currentConfigSignature,
        runSingleAlgorithm
    ]);

    const runSelectedAlgorithms = useCallback(async (): Promise<void> => {
        if (selectedAlgorithmIds.length === 0) return;

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const nextRunning: Record<AlgorithmId, boolean> = {
            ilp: false,
            cpsat: false,
            dp: false,
            greedy: false,
            genetic: false
        };
        for (const id of selectedAlgorithmIds) nextRunning[id] = true;
        setRunningAlgorithms(nextRunning);

        let firstValidAlgo: AlgorithmId | null = null;

        try {
            for (const id of selectedAlgorithmIds) {
                if (controller.signal.aborted) break;

                setProgressMap(prev => ({
                    ...prev,
                    [id]: {
                        algorithmId: id,
                        phase: 'Starting optimization...',
                        percent: 5
                    }
                }));

                const res = await runAlgorithmById(
                    id,
                    sharedInput,
                    algorithmConfigs,
                    prog => {
                        setProgressMap(prev => ({ ...prev, [id]: prog }));
                    },
                    controller.signal
                );

                setResults(prev => ({ ...prev, [id]: res }));
                setRunningAlgorithms(prev => ({ ...prev, [id]: false }));
                setProgressMap(prev => ({
                    ...prev,
                    [id]: {
                        algorithmId: id,
                        phase: 'Complete',
                        percent: 100,
                        bestScore: res.primaryObjectiveScore,
                        statesExplored: res.statesExplored,
                        convergenceHistory: res.convergenceHistory
                    }
                }));

                if (
                    !firstValidAlgo &&
                    res.validation.isValid &&
                    (res.status === 'optimal' || res.status === 'feasible')
                ) {
                    firstValidAlgo = id;
                }
            }

            if (firstValidAlgo) {
                setActiveCalendarSource(firstValidAlgo);
            }
        } finally {
            setRunningAlgorithms({
                ilp: false,
                cpsat: false,
                dp: false,
                greedy: false,
                genetic: false
            });
        }
    }, [selectedAlgorithmIds, sharedInput, algorithmConfigs]);

    const value = useMemo<OptimizationContextValue>(
        () => ({
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
            setAlgorithmSelected,
            selectedAlgorithmIds,
            rules,
            setRules,
            resetRules,
            algorithmConfigs,
            updateAlgorithmConfig,
            resetAlgorithmConfig,
            sharedInput,
            currentConfigSignature,
            isResultStale,
            hasAnyStaleResults,
            results,
            progressMap,
            isRunning,
            runningAlgorithms,
            runSelectedAlgorithms,
            runSingleAlgorithm,
            cancelOptimization,
            clearResults,
            activeCalendarSource,
            setActiveCalendarSource,
            currentRoute,
            navigate
        }),
        [
            startDate,
            setStartDate,
            endDate,
            setEndDate,
            duration,
            setDuration,
            includeWeekends,
            manualPTODates,
            toggleManualPTODate,
            clearManualPTODates,
            selectedAlgorithms,
            toggleAlgorithm,
            setAlgorithmSelected,
            selectedAlgorithmIds,
            rules,
            resetRules,
            algorithmConfigs,
            updateAlgorithmConfig,
            resetAlgorithmConfig,
            sharedInput,
            currentConfigSignature,
            isResultStale,
            hasAnyStaleResults,
            results,
            progressMap,
            isRunning,
            runningAlgorithms,
            runSelectedAlgorithms,
            runSingleAlgorithm,
            cancelOptimization,
            clearResults,
            activeCalendarSource,
            currentRoute,
            navigate
        ]
    );

    return (
        <OptimizationContext.Provider value={value}>{children}</OptimizationContext.Provider>
    );
}

export function useOptimization() {
    const ctx = useContext(OptimizationContext);
    if (!ctx) {
        throw new Error('useOptimization must be used within an OptimizationProvider');
    }
    return ctx;
}
