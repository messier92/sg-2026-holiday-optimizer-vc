import { analyzeBreaks } from '../shared/calendar/index.ts';
import { isAllocationHardValid } from '../shared/constraints/index.ts';
import { evaluateObjective } from '../shared/objectives/index.ts';
import { chromosomeToDates } from './chromosome.ts';
import type { Chromosome, GARunContext } from './types.ts';

/**
 * Evaluates the fitness of a repaired chromosome.
 * Valid chromosomes receive their true objective score; chromosomes that still fail global
 * break count constraints receive a heavy penalty and `isValid = false` so they are never
 * returned as a valid solution.
 */
export function evaluateChromosomeFitness(genes: Uint8Array, ctx: GARunContext): Chromosome {
    const dates = chromosomeToDates(genes, ctx);
    const isValid = isAllocationHardValid(ctx.calendarDays, dates, ctx.input);
    const evalObj = evaluateObjective(ctx.calendarDays, dates, ctx.input, true);

    if (isValid) {
        return {
            genes,
            fitness: evalObj.combinedScore,
            primaryScore: evalObj.primaryScore,
            secondaryScore: evalObj.secondaryScore,
            isValid: true
        };
    }

    // Compute structured penalty to guide evolution toward satisfying global break count constraints
    const { qualifyingBreaks, categoryCounts } = analyzeBreaks(
        ctx.calendarDays,
        dates,
        ctx.input.rules.breakDuration
    );
    const { rules } = ctx.input;
    let penalty = 1e9;

    if (qualifyingBreaks.length < rules.distribution.minNumberOfBreaks) {
        penalty += (rules.distribution.minNumberOfBreaks - qualifyingBreaks.length) * 1e7;
    }
    if (
        rules.distribution.maxNumberOfBreaks !== null &&
        qualifyingBreaks.length > rules.distribution.maxNumberOfBreaks
    ) {
        penalty += (qualifyingBreaks.length - rules.distribution.maxNumberOfBreaks) * 1e7;
    }

    for (const catKey of ['short', 'medium', 'long', 'extended'] as const) {
        const r = rules.breakDuration[catKey];
        if (!r.enabled) continue;
        if (categoryCounts[catKey] < r.minCount) {
            penalty += (r.minCount - categoryCounts[catKey]) * 1e7;
        }
        if (r.maxCount !== null && categoryCounts[catKey] > r.maxCount) {
            penalty += (categoryCounts[catKey] - r.maxCount) * 1e7;
        }
    }

    if (dates.length < ctx.minPTORequired) {
        penalty += (ctx.minPTORequired - dates.length) * 5e6;
    }

    return {
        genes,
        fitness: evalObj.combinedScore - penalty,
        primaryScore: evalObj.primaryScore,
        secondaryScore: evalObj.secondaryScore,
        isValid: false
    };
}
