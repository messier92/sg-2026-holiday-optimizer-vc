import { BarChart3, Sparkles } from 'lucide-react';
import { useOptimization, type AppRoute } from '@/context/OptimizationContext';
import { ALGORITHM_METADATA } from '@/core';

export function Header() {
    const { currentRoute, navigate, selectedAlgorithmIds } = useOptimization();

    return (
        <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-white/10">
            <div className="container mx-auto px-6 h-16 flex items-center justify-between gap-4">
                <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 text-left"
                >
                    <div className="p-2 rounded-xl bg-gradient-to-tr from-indigo-500 to-purple-500 text-white shadow-lg shadow-indigo-500/20">
                        <Sparkles size={20} />
                    </div>
                    <span className="font-bold text-lg tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400">
                        SG Holiday Optimizer 2027
                    </span>
                </button>

                <nav className="flex items-center gap-1.5 overflow-x-auto py-1">
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                            currentRoute === '/'
                                ? 'bg-indigo-600 text-white'
                                : 'hover:bg-indigo-500/10 text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        Calendar & Planner
                    </button>

                    {selectedAlgorithmIds.map(id => {
                        const meta = ALGORITHM_METADATA[id];
                        const isActive = currentRoute === meta.route;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => navigate(meta.route as AppRoute)}
                                className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                    isActive
                                        ? 'bg-indigo-600 text-white'
                                        : 'hover:bg-indigo-500/10 text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                {meta.shortName}
                            </button>
                        );
                    })}

                    {selectedAlgorithmIds.length > 1 && (
                        <button
                            type="button"
                            onClick={() => navigate('/algorithms/compare')}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                                currentRoute === '/algorithms/compare'
                                    ? 'bg-purple-600 text-white'
                                    : 'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20'
                            }`}
                        >
                            <BarChart3 className="w-3.5 h-3.5" />
                            Compare ({selectedAlgorithmIds.length})
                        </button>
                    )}
                </nav>
            </div>
        </header>
    );
}
