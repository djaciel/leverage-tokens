# Leverage Token Backtester

A comprehensive TypeScript backtesting framework for simulating and analyzing leverage token strategies on DeFi lending protocols.

## Quick Start

```bash
# Install dependencies
pnpm install

# Extract historical data for a strategy
pnpm extract:weETH-WETH-17x

# Run single backtest (deterministic)
pnpm backtest:weETH-WETH-17x

# Run multiple simulations with statistics
pnpm backtest:weETH-WETH-17x --runs=200
```

## What is this?

This backtester simulates the behavior of leverage tokens (like weETH-WETH-17x) by:

1. **Extracting historical data** - Fetches price data for collateral, debt, and borrow rates
2. **Simulating rebalances** - Models Dutch Auction mechanics with realistic timing
3. **Calculating performance** - Generates metrics like returns, drawdowns, and gas costs
4. **Statistical analysis** - Runs multiple simulations to understand outcome distributions

## Core Concepts

### Leverage Tokens

A leverage token maintains a target leverage ratio (e.g., 17x) by:
- Depositing collateral (e.g., weETH) into a lending protocol
- Borrowing debt (e.g., WETH) against it
- Automatically rebalancing when the ratio drifts outside bounds

### Collateral Ratio

The ratio of collateral value to debt value. For 17x leverage:
- **Target ratio**: 1.0625 (collateral worth 6.25% more than debt)
- **Min ratio**: 1.06135 (too risky, need to reduce leverage)
- **Max ratio**: 1.062893 (too safe, need to increase leverage)

### Rebalancing

When the ratio goes outside bounds, a Dutch Auction starts:
- **Auction creation**: Someone creates an auction when out of bounds
- **Auction duration**: ~40 minutes with exponential decay pricing
- **Execution**: Arbitrageurs execute when price is favorable
- **Emergency mode**: Fast-tracked for pre-liquidation scenarios

## Usage

### 1. Extract Data for a Strategy

Before running a backtest, you need historical price data:

```bash
# Extract data for weETH-WETH-17x strategy
pnpm extract:weETH-WETH-17x

# Or manually specify strategy
pnpm backtest:weETH-WETH-17x --extract-only
```

This downloads and caches:
- **ETH prices** from Binance (5-minute candles)
- **weETH prices** from DeFiLlama (hourly)
- **Borrow APY** from Morpho Blue (daily)

Data is stored in `data/` directory and reused across runs. Only missing gaps are fetched.

### 2. Run a Backtest

**Single deterministic run:**

```bash
pnpm backtest:weETH-WETH-17x
```

**Multiple runs with statistical aggregation:**

```bash
pnpm backtest:weETH-WETH-17x --runs=200
```

This produces:
- Mean, median, P5, P95 for all metrics
- Distribution of returns and drawdowns
- Aggregated rebalance statistics

### 3. View Results

Results are saved to `results/` directory with format:

```
results/
├── weETH-WETH-17x-base-2025-10-08-14-30.json          # Single run
├── weETH-WETH-17x-base-2025-10-08-14-45-stats.json   # Multi-run stats
└── weETH-WETH-17x-base-2025-10-08-14-45-all-runs.json # All run metrics
```

**Example output:**

```
📊 BACKTEST RESULTS - weETH-WETH-17x
============================================================

📅 Period:
   Start: 2025-06-05
   End:   2025-10-05
   Duration: 122.0 days

💰 Performance:
   Total Return:        1.68%
   Annualized Return:   5.11%
   Max Drawdown:        75.49%

🔄 Rebalancing:
   Total Rebalances:    47
   Gas Costs (est):     $235.00
   Avg Collateral Ratio: 1.062456
```

## Creating a New Strategy

### Step 1: Define the Strategy

Create a new file in `src/strategies/`:

```typescript
// src/strategies/stBTC-WBTC-5x.ts

import { StrategyConfig } from '../types/strategy';
import { DataAdapter } from '../data-extraction/adapters/base';

export const STBTC_WBTC_5X: StrategyConfig = {
  name: 'stBTC-WBTC-5x',

  collateral: {
    symbol: 'stBTC',
    chain: 'ethereum',
    address: '0x...',  // stBTC contract address
    adapter: DataAdapter.DEFILLAMA,
  },

  debt: {
    symbol: 'BTC',
    adapter: DataAdapter.BINANCE,
  },

  leverage: {
    target: 5,     // 5x leverage
    min: 4.9,      // Minimum 4.9x
    max: 5.1,      // Maximum 5.1x
  },

  // These will be calculated in Step 2
  collateralRatios: {
    min: 1.245,
    target: 1.25,
    max: 1.256,
    preLiquidationThreshold: 1.240,
  },

  timeRangeData: {
    from: Math.floor(new Date('2024-01-01').getTime() / 1000),
    to: Math.floor(new Date('2025-10-01').getTime() / 1000),
  },

  timeRangeBacktest: {
    from: Math.floor(new Date('2025-01-01').getTime() / 1000),
    to: Math.floor(new Date('2025-10-01').getTime() / 1000),
  },

  lendingMarket: {
    marketId: '0x...', // Morpho market ID
    adapter: DataAdapter.MORPHO,
    chainId: 1,  // Ethereum mainnet
    lltv: 0.86,  // 86% LLTV from Morpho
    preLiquidationLeverage: 5.2,  // Emergency rebalance threshold
  },
};
```

### Step 2: Calculate Collateral Ratios

Use the built-in calculator to compute precise collateral ratios:

```bash
STRATEGY=stBTC-WBTC-5x pnpm calculate-ratios
```

Copy the output values back into your strategy configuration.

### Step 3: Register the Strategy

Add your strategy to `src/strategies/index.ts` and add npm scripts to `package.json`.

### Step 4: Extract and Backtest

```bash
# Extract historical data
pnpm extract:stBTC-WBTC-5x

# Run backtest
pnpm backtest:stBTC-WBTC-5x
```

## Understanding Leverage Ranges

The `leverage` configuration defines the operating range using intuitive leverage values (e.g., 16.9x - 17x - 17.3x) instead of abstract collateral ratios.

**Relationship to collateral ratio:** Leverage and collateral ratio are inversely related via the formula `CR = leverage / (leverage - 1)`.

## Technical README

- [**Technical Documentation**](./TECHNICAL.md) - Architecture, design decisions, and implementation details
