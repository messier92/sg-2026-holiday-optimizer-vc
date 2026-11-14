import { solveWithCPSAT } from './cpsat/index.ts';
import { solveWithDP } from './dp/index.ts';
import { solveWithGenetic } from './genetic/index.ts';
import { solveWithGreedy } from './greedy/index.ts';
import { solveWithILP } from './ilp/index.ts';
import type {
    AlgorithmConfigs,
    AlgorithmId,
    OptimizationProgress,
    OptimizationResult,
    SharedOptimizationInput
} from './shared/types/index.ts';

export * from './shared/types/index.ts';
export * from './shared/calendar/index.ts';
export * from './shared/constraints/index.ts';
export * from './shared/objectives/index.ts';
export * from './shared/results/index.ts';
export * from './shared/validation/index.ts';
export { solveWithILP } from './ilp/index.ts';
export { solveWithCPSAT } from './cpsat/index.ts';
export { solveWithDP } from './dp/index.ts';
export { solveWithGreedy } from './greedy/index.ts';
export { solveWithGenetic } from './genetic/index.ts';

/**
 * Computes a deterministic JSON signature for the shared inputs so stale results
 * can be accurately detected when the user updates dates, PTO allowance, or rules.
 */
export function computeSharedConfigSignature(input: SharedOptimizationInput): string {
    return JSON.stringify({
        startDate: input.startDate,
        endDate: input.endDate,
        ptoAllowance: input.ptoAllowance,
        rules: input.rules
    });
}

/**
 * Executes a single optimization algorithm by its identifier.
 */
export async function runAlgorithmById(
    algorithmId: AlgorithmId,
    input: SharedOptimizationInput,
    configs: AlgorithmConfigs,
    onProgress?: (progress: OptimizationProgress) => void,
    signal?: AbortSignal
): Promise<OptimizationResult> {
    const signature = computeSharedConfigSignature(input);
    let result: OptimizationResult;

    switch (algorithmId) {
        case 'ilp':
            result = await solveWithILP({
                input,
                config: configs.ilp,
                onProgress,
                signal
            });
            break;
        case 'cpsat':
            result = await solveWithCPSAT({
                input,
                config: configs.cpsat,
                onProgress,
                signal
            });
            break;
        case 'dp':
            result = await solveWithDP({
                input,
                config: configs.dp,
                onProgress,
                signal
            });
            break;
        case 'greedy':
            result = await solveWithGreedy({
                input,
                config: configs.greedy,
                onProgress,
                signal
            });
            break;
        case 'genetic':
            result = await solveWithGenetic({
                input,
                config: configs.genetic,
                onProgress,
                signal
            });
            break;
    }

    result.configSignature = signature;
    return result;
}
