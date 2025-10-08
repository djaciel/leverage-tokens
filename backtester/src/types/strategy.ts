/**
 * Strategy configuration types
 */

import { Chain, TimeRange } from './data-sources';
import { DataAdapter } from '../data-extraction/adapters/base';

/**
 * Token configuration with price adapter specification
 */
export interface TokenConfig {
  symbol: string;
  chain?: Chain;
  address?: string;
  adapter: DataAdapter;
}

/**
 * Leverage token strategy configuration
 */
export interface StrategyConfig {
  /** Strategy name (e.g., 'WEETH-WETH-17x') */
  name: string;

  /** Collateral token (first part, e.g., 'WEETH') */
  collateral: TokenConfig;

  /** Debt/base token (second part, e.g., 'WETH') */
  debt: TokenConfig;

  /** Leverage multiplier (e.g., 17) */
  leverage: number;

  /** Collateral ratio bounds */
  collateralRatios: {
    min: number;
    target: number;
    max: number;
    /** Pre-liquidation threshold for emergency rebalances (from PreLiquidationRebalanceAdapter) */
    preLiquidationThreshold: number;
  };

  /** TimeRange for prices data */
  timeRangeData: TimeRange;

  /** TimeRange for backtest */
  timeRangeBacktest: TimeRange;

  /** Lending market configuration */
  lendingMarket: {
    marketId: string;
    adapter: DataAdapter;
    chainId: number;
  };
}
