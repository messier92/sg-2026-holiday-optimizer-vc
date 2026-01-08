import React, { useState } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getMaximizePTO } from '@/lib/maxleavealgorithm';

function cn(...inputs: (string | undefined | null | false)[]) {
    return twMerge(clsx(inputs));
}

const PUBLIC_HOLIDAYS_2026 = [
    { date: '2026-01-01', name: "New Year's Day" },
    { date: '2026-02-17', name: "Chinese New Year" },
    { date: '2026-02-18', name: "Chinese New Year" },
    { date: '2026-03-21', name: "Hari Raya Puasa" },
    { date: '2026-04-03', name: "Good Friday" },
    { date: '2026-05-01', name: "Labour Day" },
    { date: '2026-05-27', name: "Hari Raya Haji" },
    { date: '2026-05-31', name: "Vesak Day" },
    { date: '2026-06-01', name: "Vesak Day (Observed)" }, // Monday off
    { date: '2026-08-09', name: "National Day" },
    { date: '2026-08-10', name: "National Day (Observed)" }, // Monday off
    { date: '2026-11-08', name: "Deepavali" },
    { date: '2026-11-09', name: "Deepavali (Observed)" }, // Monday off
    { date: '2026-12-25', name: "Christmas Day" },
];

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function getDaysInMonth(year: number, month: number) {
    return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
    return new Date(year, month, 1).getDay();
}

export function Calendar() {
    const year = 2026;
    const [duration, setDuration] = useState(7);
    const [startDate, setStartDate] = useState('2026-01-01');
    const [PTO_DATES, setPTO_DATES] = useState<string[]>([]);
    const [includeWeekends, setIncludeWeekends] = useState(true);

    React.useEffect(() => {
        const suggestedDates = getMaximizePTO(startDate, duration, PUBLIC_HOLIDAYS_2026);
        setPTO_DATES(suggestedDates);
    }, [startDate, duration]);

    return (
        <section id="calendar" className="py-24 bg-background relative overflow-hidden">
            <div className="container mx-auto px-6 relative z-10">
                <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-5xl font-bold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500">
                        2026 Calendar
                    </h2>
                    <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                        Plan your holidays around these official dates.
                    </p>
                    <div>
                        <span className="inline-block mx-1 w-3 h-3 rounded-full bg-red-500/80"></span> indicates a Public Holiday
                        <span className="inline-block mx-1 w-3 h-3 rounded-full bg-indigo-500/20"></span> indicates a Weekend
                        <span className="inline-block mx-1 w-3 h-3 rounded-full bg-green-500/80"></span> indicates your PTO
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                    {MONTHS.map((monthName, monthIndex) => {
                        const daysInMonth = getDaysInMonth(year, monthIndex);
                        const firstDay = getFirstDayOfMonth(year, monthIndex);
                        const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
                        const paddingDays = Array.from({ length: firstDay }, (_, i) => null);

                        return (
                            <div
                                key={monthName}
                                className="bg-white/50 dark:bg-white/5 border border-white/20 backdrop-blur-sm rounded-3xl p-6 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
                            >
                                <h3 className="text-xl font-bold mb-4 text-center">{monthName}</h3>

                                <div className="grid grid-cols-7 gap-1 text-center mb-2">
                                    {DAYS.map((day, index) => (
                                        <div key={`${day}-${index}`} className="text-xs font-semibold text-muted-foreground">
                                            {day}
                                        </div>
                                    ))}
                                </div>

                                <div className="grid grid-cols-7 gap-1 text-center text-sm">
                                    {paddingDays.map((_, i) => (
                                        <div key={`pad-${i}`} />
                                    ))}

                                    {days.map((day, index) => {
                                        const dateStr = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                        const holiday = PUBLIC_HOLIDAYS_2026.find(h => h.date === dateStr);
                                        const isPTO = PTO_DATES.includes(dateStr);
                                        const date = new Date(year, monthIndex, day);
                                        const isWeekend = date.getDay() === 0 || date.getDay() === 6;

                                        // Compare with start date (normalized to midnight)
                                        const startObj = new Date(startDate);
                                        startObj.setHours(0, 0, 0, 0);
                                        const isPast = date < startObj;

                                        return (
                                            <div
                                                key={`${day}-${index}`}
                                                className={cn(
                                                    "aspect-square flex items-center justify-center rounded-lg transition-colors relative group cursor-default",
                                                    isPast && "opacity-25 line-through cursor-not-allowed",
                                                    !isPast && isWeekend && "bg-indigo-500/5 text-indigo-700 dark:text-indigo-300",
                                                    !isPast && holiday
                                                        ? "bg-red-500 text-white font-bold shadow-md shadow-red-500/20"
                                                        : !isPast && isPTO
                                                            ? "bg-green-500 text-white font-bold shadow-md shadow-green-500/20"
                                                            : !isPast && "hover:bg-neutral-100 dark:hover:bg-white/10"
                                                )}
                                                title={holiday?.name ?? (isPTO ? 'PTO' : undefined)}
                                            >
                                                {day}
                                                {(holiday || isPTO) && !isPast && (
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs bg-gray-900 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-50 pointer-events-none">
                                                        {holiday ? holiday.name : 'PTO'}
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

                <div className="mt-16 max-w-4xl mx-auto p-6 rounded-2xl bg-white/50 dark:bg-white/5 border border-white/20 backdrop-blur-sm">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div>
                                <label htmlFor="start-date" className="block text-sm font-semibold mb-2">
                                    Start Date
                                </label>
                                <input
                                    id="start-date"
                                    type="date"
                                    value={startDate}
                                    min="2026-01-01"
                                    max="2026-12-31"
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full px-4 py-2 rounded-lg bg-white/50 dark:bg-black/20 border border-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label htmlFor="duration-slider" className="text-sm font-semibold">
                                        Min Duration
                                    </label>
                                    <span className="text-xl font-bold text-indigo-600 dark:text-indigo-400">
                                        {duration} days
                                    </span>
                                </div>
                                <input
                                    id="duration-slider"
                                    type="range"
                                    min="7"
                                    max="30"
                                    value={duration}
                                    onChange={(e) => setDuration(Number(e.target.value))}
                                    className="w-full h-2 bg-neutral-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-600 dark:accent-indigo-500"
                                />
                                <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                                    <span>7 days</span>
                                    <span>30 days</span>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white/40 dark:bg-black/20 rounded-xl p-6 border border-white/10 flex flex-col justify-center space-y-4">
                            {(() => {
                                // Calculate Stats on the fly
                                const start = new Date(startDate);
                                start.setHours(0, 0, 0, 0);
                                const end = new Date(2026, 11, 31);

                                let working = 0;
                                let nonWorking = 0;
                                let daysIter = new Date(start);

                                while (daysIter <= end) {
                                    const dStr = daysIter.toISOString().split('T')[0];
                                    const isWknd = daysIter.getDay() === 0 || daysIter.getDay() === 6;
                                    const isPH = PUBLIC_HOLIDAYS_2026.some(h => h.date === dStr);
                                    const isPTO = PTO_DATES.includes(dStr);

                                    if (!includeWeekends && isWknd) {
                                        // Skip weekends entirely if unchecked
                                        daysIter.setDate(daysIter.getDate() + 1);
                                        continue;
                                    }

                                    if (isWknd || isPH || isPTO) {
                                        nonWorking++;
                                    } else {
                                        working++;
                                    }
                                    daysIter.setDate(daysIter.getDate() + 1);
                                }

                                return (
                                    <>
                                        <div className="flex justify-between items-center border-b border-indigo-500/20 pb-2">
                                            <span className="text-muted-foreground">Working Days</span>
                                            <span className="text-2xl font-bold">{working}</span>
                                        </div>
                                        <div className="flex justify-between items-center pt-2">
                                            <span className="text-muted-foreground">Non-Working Days</span>
                                            <span className="text-2xl font-bold text-indigo-500">{nonWorking}</span>
                                        </div>

                                        <div className="flex items-center justify-center gap-2 mt-4 pt-2 border-t border-white/10">
                                            <input
                                                type="checkbox"
                                                id="include-weekends"
                                                checked={includeWeekends}
                                                onChange={(e) => setIncludeWeekends(e.target.checked)}
                                                className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            <label htmlFor="include-weekends" className="text-xs text-muted-foreground cursor-pointer select-none">
                                                Include Weekends
                                            </label>
                                        </div>

                                        <div className="text-[10px] text-center text-muted-foreground/50 mt-1">
                                            (From {startDate} to Dec 31)
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
