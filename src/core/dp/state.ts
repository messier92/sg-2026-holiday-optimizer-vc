import type { DPConfig, SharedOptimizationInput } from '../shared/types/index.ts';
import type { DPComplexityEstimate, DPStateNode } from './types.ts';

/**
 * Computes a canonical memoization key for a DPStateNode on a given day.
 * Only includes state dimensions that are active under the current ruleset
 * to avoid unnecessary state-space explosion while preserving exactness.
 */
export function getDPStateKey(
    state: DPStateNode,
    input: SharedOptimizationInput,
    trackGlobalCounts: boolean
): string {
    const { rules } = input;
    const consecPart = rules.allocation.maxConsecutivePTOWorkingDays !== null ? state.curConsecPTO : 0;
    const calPart =
        rules.distribution.minCalendarDaysBetweenBreaks !== null &&
        rules.distribution.minCalendarDaysBetweenBreaks > 0
            ? state.calCooldown
            : 0;
    const hasPTOInCurBreak = state.curBreakPTO > 0 ? 1 : 0;
    const hasICTInCurBreak = state.curBreakICT > 0 ? 1 : 0;

    if (!trackGlobalCounts) {
        return `${state.remPTO}|${state.remICT}|${state.curOffDays}|${hasPTOInCurBreak}|${hasICTInCurBreak}|${consecPart}|${state.workCooldown}|${calPart}`;
    }

    return `${state.remPTO}|${state.remICT}|${state.curOffDays}|${hasPTOInCurBreak}|${hasICTInCurBreak}|${consecPart}|${state.workCooldown}|${calPart}|${state.qualifyingBreaks}|${state.shortCount},${state.mediumCount},${state.longCount},${state.extendedCount}`;
}

/**
 * Estimates the state-space complexity of the DP run before execution and documents any
 * state-space warnings.
 */
export function estimateDPComplexity(
    numCalendarDays: number,
    input: SharedOptimizationInput,
    config: DPConfig
): DPComplexityEstimate {
    const { ptoAllowance, rules } = input;
    const availablePTO = Math.max(0, ptoAllowance - rules.allocation.reservePTODays);
    const workSpacing = Math.max(1, rules.distribution.minWorkingDaysBetweenBreaks);

    const hasCategoryConstraints = (['short', 'medium', 'long', 'extended'] as const).some(
        c =>
            rules.breakDuration[c].enabled &&
            (rules.breakDuration[c].minCount > 0 || rules.breakDuration[c].maxCount !== null)
    );
    const hasBreakCountBounds =
        rules.distribution.minNumberOfBreaks > 0 || rules.distribution.maxNumberOfBreaks !== null;

    const countMultiplier = hasCategoryConstraints ? 12 : hasBreakCountBounds ? 4 : 1;
    const estimatedStatesPerDay =
        (availablePTO + 1) * Math.min(25, workSpacing + 10) * countMultiplier;
    const estimatedTotalStates = config.enableMemoization
        ? estimatedStatesPerDay * Math.max(1, Math.floor(numCalendarDays * 0.35))
        : Math.pow(2, Math.min(30, numCalendarDays));

    const likelyToExceedLimits =
        !config.enableMemoization ||
        estimatedStatesPerDay > config.maxStateCount ||
        estimatedTotalStates > config.stateExplorationLimit;

    const unsupportedNotes: string[] = [];
    if (
        rules.objectives.primary === 'maximize_break_distribution' ||
        rules.objectives.secondaries.prefer_evenly_distributed_breaks.enabled ||
        rules.distribution.evenlyDistributeBreaks
    ) {
        unsupportedNotes.push(
            'Global variance of break gaps is non-separable across single-day transitions; DP evaluates exact global distribution at terminal states.'
        );
    }

    let warningMessage: string | undefined;
    if (!config.enableMemoization && numCalendarDays > 20) {
        warningMessage =
            'Memoization is disabled: exponential state growth will occur on date ranges longer than ~20 days and may hit the state exploration limit.';
    } else if (likelyToExceedLimits) {
        warningMessage = `Estimated DP state space (~${estimatedTotalStates.toLocaleString()} states) may approach or exceed the configured exploration limit (${config.stateExplorationLimit.toLocaleString()}).`;
    }

    return {
        estimatedStatesPerDay,
        estimatedTotalStates,
        likelyToExceedLimits,
        warningMessage,
        unsupportedNotes
    };
}

/**
 * Reconstructs the selected PTO dates by following backpointers from a terminal DPStateNode.
 */
export function reconstructDPSelectedDates(
    terminalState: DPStateNode,
    calendarDates: string[]
): string[] {
    const selected: string[] = [];
    let cur: DPStateNode | null = terminalState;

    while (cur && cur.parent !== null) {
        if (cur.tookPTOOnPrevDay) {
            const dayIdx = cur.dayIndex - 1;
            if (dayIdx >= 0 && dayIdx < calendarDates.length) {
                selected.push(calendarDates[dayIdx]);
            }
        }
        cur = cur.parent;
    }

    return selected.reverse();
}

/**
 * Reconstructs the selected ICT dates by following backpointers from a terminal DPStateNode.
 */
export function reconstructDPSelectedICTDates(
    terminalState: DPStateNode,
    calendarDates: string[]
): string[] {
    const selected: string[] = [];
    let cur: DPStateNode | null = terminalState;

    while (cur && cur.parent !== null) {
        if (cur.tookICTOnPrevDay) {
            const dayIdx = cur.dayIndex - 1;
            if (dayIdx >= 0 && dayIdx < calendarDates.length) {
                selected.push(calendarDates[dayIdx]);
            }
        }
        cur = cur.parent;
    }

    return selected.reverse();
}
