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

  /** Leverage configuration */
  leverage: {
    /** Target leverage (e.g., 17 for 17x) */
    target: number;
    /** Minimum leverage - more conservative (e.g., 16.9 for 16.9x) */
    min: number;
    /** Maximum leverage - more aggressive (e.g., 17.3 for 17.3x) */
    max: number;
  };

  /** Collateral ratio bounds (calculated from leverage) */
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
    /** Loan-to-Liquidation-Threshold-Value from Morpho market (e.g., 0.945 for 94.5%) */
    lltv: number;
    /** Pre-liquidation leverage threshold for emergency rebalances (e.g., 17.5 for 17.5x) */
    preLiquidationLeverage: number;
  };
}
