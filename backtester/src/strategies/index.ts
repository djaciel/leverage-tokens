/**
 * Strategy Registry
 *
 * Central registry for all available leverage token strategies
 */

import { StrategyConfig } from '../types/strategy';
import { WEETH_WETH_17X } from './weETH-WETH-17x';

/**
 * All available strategies
 */
export const STRATEGIES: Record<string, StrategyConfig> = {
  'weETH-WETH-17x': WEETH_WETH_17X,
};

/**
 * Get strategy by name
 */
export function getStrategy(name: string): StrategyConfig {
  const strategy = STRATEGIES[name];
  if (!strategy) {
    const available = Object.keys(STRATEGIES).join(', ');
    throw new Error(
      `Strategy "${name}" not found. Available strategies: ${available}`
    );
  }
  return strategy;
}

/**
 * List all available strategy names
 */
export function listStrategies(): string[] {
  return Object.keys(STRATEGIES);
}
