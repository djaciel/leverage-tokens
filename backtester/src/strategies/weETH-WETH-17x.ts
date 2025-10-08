/**
 * weETH-WETH 17x Leverage Strategy
 *
 * High leverage strategy on weETH/WETH pair
 * Deployed on Base chain
 */

import { StrategyConfig } from '../types/strategy';
import { DataAdapter } from '../data-extraction/adapters/base';

export const WEETH_WETH_17X: StrategyConfig = {
  name: 'weETH-WETH-17x',

  collateral: {
    symbol: 'weETH',
    chain: 'base',
    address: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A',
    adapter: DataAdapter.DEFILLAMA,
  },

  debt: {
    symbol: 'ETH',
    adapter: DataAdapter.BINANCE,
  },

  leverage: 17,

  collateralRatios: {
    min: 1.06135, // From CollateralRatiosRebalanceAdapter
    target: 1.0625,
    max: 1.062893082,
    preLiquidationThreshold: 1.06061, // From PreLiquidationRebalanceAdapter
  },

  timeRangeData: {
    from: Math.floor(new Date('2025-01-01').getTime() / 1000),
    to: Math.floor(new Date('2025-10-05').getTime() / 1000),
  },

  timeRangeBacktest: {
    from: Math.floor(new Date('2025-06-05').getTime() / 1000),
    to: Math.floor(new Date('2025-10-05').getTime() / 1000),
  },

  lendingMarket: {
    marketId: '0xfd0895ba253889c243bf59bc4b96fd1e06d68631241383947b04d1c293a0cfea',
    adapter: DataAdapter.MORPHO,
    chainId: 8453, // Base
  },
};
