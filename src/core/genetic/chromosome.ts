import { buildCalendarDays, isWorkingDayAllowedForPTO } from '../shared/calendar/index.ts';
import type { SharedOptimizationInput } from '../shared/types/index.ts';
import type { Chromosome, GARunContext, SeededRNG } from './types.ts';

/**
 * Deterministic Mulberry32 PRNG for reproducible Genetic Algorithm execution.
 */
export function createSeededRNG(seed: number): SeededRNG {
    let state = (seed >>> 0) || 1;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function createGARunContext(input: SharedOptimizationInput): GARunContext {
    const calendarDays = buildCalendarDays(
        input.startDate,
        input.endDate,
        input.publicHolidays,
        input.rules.restrictions
    );
    const workingDays = calendarDays.filter(d => d.isEligibleWorkingDay);
    const M = workingDays.length;

    const allowedMask = new Uint8Array(M);
    const requiredMask = new Uint8Array(M);
    const bridgePriorityIndices: number[] = [];

    for (let i = 0; i < M; i++) {
        const w = workingDays[i];
        if (isWorkingDayAllowedForPTO(w, input.rules)) {
            allowedMask[i] = 1;
            if (w.isAdjacentToHoliday || w.isAdjacentToWeekend) {
                bridgePriorityIndices.push(i);
            }
        }
        if (w.isRequiredPTO) {
            requiredMask[i] = 1;
        }
    }

    const availablePTO = Math.max(0, input.ptoAllowance - input.rules.allocation.reservePTODays);
    const minPTORequired = input.rules.allocation.allowUnusedPTO
        ? input.rules.allocation.minPTOToAllocate
        : availablePTO;

    return {
        calendarDays,
        workingDays,
        allowedMask,
        requiredMask,
        bridgePriorityIndices,
        availablePTO,
        minPTORequired,
        input
    };
}

export function cloneChromosome(ch: Chromosome): Chromosome {
    return {
        genes: new Uint8Array(ch.genes),
        fitness: ch.fitness,
        primaryScore: ch.primaryScore,
        secondaryScore: ch.secondaryScore,
        isValid: ch.isValid
    };
}

export function chromosomeToDates(genes: Uint8Array, ctx: GARunContext): string[] {
    const dates: string[] = [];
    for (let i = 0; i < genes.length; i++) {
        if (genes[i] === 1) {
            dates.push(ctx.workingDays[i].date);
        }
    }
    return dates;
}
