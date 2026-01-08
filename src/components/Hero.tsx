import { ArrowRight, Sun, Coffee, Briefcase, Plane } from 'lucide-react';

export function Hero() {
    return (
        <div className="relative min-h-[80vh] flex flex-col justify-center overflow-hidden pt-16">
            {/* Background decoration */}
            <div className="absolute inset-0 -z-10">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-to-tr from-indigo-500/20 via-purple-500/20 to-pink-500/20 rounded-full blur-[100px] opacity-70" />
                <div className="absolute bottom-0 right-0 w-[800px] h-[600px] bg-gradient-to-bl from-blue-500/20 via-sky-500/20 to-teal-500/20 rounded-full blur-[100px] opacity-70" />
                {/* Grid pattern overlay */}
                <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,black_70%,transparent_100%)]" />
            </div>

            <div className="container mx-auto px-6 relative">
                <div className="max-w-4xl mx-auto text-center mb-16 px-4">

                    <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-balance mb-8 bg-clip-text text-transparent bg-gradient-to-b from-foreground to-foreground/60 drop-shadow-sm animate-in fade-in slide-in-from-bottom-8 duration-1000 fill-mode-both delay-100">
                        Singapore <br />
                        Public Holiday <br />
                        <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500">2026 Optimizer</span>
                    </h1>

                    <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed animate-in fade-in slide-in-from-bottom-8 duration-1000 fill-mode-both delay-200">
                        Maximize your leave days with our intelligent long-weekend planner.
                        We analyze the 2026 Singapore public holiday calendar to help you get
                        <span className="font-semibold text-foreground"> more breaks with fewer leave days</span>.
                    </p>
                </div>

                {/* Feature Cards / Visuals */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto animate-in fade-in slide-in-from-bottom-12 duration-1000 fill-mode-both delay-500">
                    {[
                        {
                            icon: <Briefcase className="w-6 h-6 text-blue-500" />,
                            title: "Smart Allocation",
                            description: "AI-driven suggestions to bridge holidays with weekends."
                        },
                        {
                            icon: <Plane className="w-6 h-6 text-purple-500" />,
                            title: "Maximize Travel",
                            description: "Get up to 48 days off with just 14 days of leave."
                        },
                        {
                            icon: <Coffee className="w-6 h-6 text-orange-500" />,
                            title: "Work-Life Balance",
                            description: "Plan your rest periods strategically to avoid burnout."
                        }
                    ].map((feature, i) => (
                        <div key={i} className="group p-6 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/20 backdrop-blur-sm hover:bg-white/80 dark:hover:bg-white/10 transition-all hover:shadow-xl hover:-translate-y-1">
                            <div className="h-12 w-12 rounded-xl bg-white dark:bg-white/10 flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform">
                                {feature.icon}
                            </div>
                            <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
                            <p className="text-sm text-muted-foreground">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
