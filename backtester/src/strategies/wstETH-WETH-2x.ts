/**
 * wstETH-WETH 2x Leverage Strategy
 *
 * High leverage strategy on wstETH/WETH pair
 * Deployed on Ethereum chain
 */

import { StrategyConfig } from '../types/strategy';
import { DataAdapter } from '../data-extraction/adapters/base';

export const wstETH_WETH_2x: StrategyConfig = {
  name: 'wstETH-WETH-2x',

  collateral: {
    symbol: 'wstETH',
    chain: 'ethereum',
    address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
    adapter: DataAdapter.DEFILLAMA,
  },

  debt: {
    symbol: 'ETH',
    adapter: DataAdapter.BINANCE,
  },

  leverage: {
    target: 2,
    min: 1.995,
    max: 2.005,
  },

  collateralRatios: {
    min: 1.9950248756218907,
    target: 2,
    max: 2.0050251256281406,
    preLiquidationThreshold: 1.9900990099009903,
  },

  timeRangeData: {
    from: Math.floor(new Date('2025-01-01').getTime() / 1000),
    to: Math.floor(new Date('2025-10-05').getTime() / 1000),
  },

  timeRangeBacktest: {
    from: Math.floor(new Date('2025-02-02').getTime() / 1000),
    to: Math.floor(new Date('2025-10-05').getTime() / 1000),
  },

  lendingMarket: {
    marketId: '0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e',
    adapter: DataAdapter.MORPHO,
    chainId: 1, // Ethereum
    lltv: 0.965, // 96.5% from Morpho UI
    preLiquidationLeverage: 2.01, // Emergency rebalance at 2.01x
  },
};
