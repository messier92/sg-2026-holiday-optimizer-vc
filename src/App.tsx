import { useEffect } from 'react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { Calendar } from './components/Calendar';
import { AlgorithmPage } from './components/AlgorithmPage';
import { ComparisonPage } from './components/ComparisonPage';
import { OptimizationProvider, useOptimization } from './context/OptimizationContext';
import { client } from './lib/appwrite';

function AppContent() {
    const { currentRoute } = useOptimization();

    return (
        <div className="min-h-screen bg-background text-foreground font-sans selection:bg-indigo-500/30 selection:text-indigo-600">
            <Header />
            <main>
                {currentRoute === '/' && (
                    <>
                        <Hero />
                        <Calendar />
                    </>
                )}
                {currentRoute === '/algorithms/ilp' && <AlgorithmPage algorithmId="ilp" />}
                {currentRoute === '/algorithms/cpsat' && <AlgorithmPage algorithmId="cpsat" />}
                {currentRoute === '/algorithms/dp' && <AlgorithmPage algorithmId="dp" />}
                {currentRoute === '/algorithms/greedy' && <AlgorithmPage algorithmId="greedy" />}
                {currentRoute === '/algorithms/genetic' && <AlgorithmPage algorithmId="genetic" />}
                {currentRoute === '/algorithms/compare' && <ComparisonPage />}
            </main>

            {/* Simple Footer */}
            <footer className="border-t border-white/10 py-12 bg-background">
                <div className="container mx-auto px-6 text-center text-sm text-muted-foreground">
                    <p>© 2027 SG Holiday Optimizer. Vibe-coded by Goh Han Long, Eugene.</p>
                </div>
            </footer>
        </div>
    );
}

function App() {
    useEffect(() => {
        client
            .ping()
            .then(response => {
                console.log('Appwrite connection verified:', response);
            })
            .catch(error => {
                console.error('Appwrite connection failed:', error);
            });
    }, []);

    return (
        <OptimizationProvider>
            <AppContent />
        </OptimizationProvider>
    );
}

export default App;
