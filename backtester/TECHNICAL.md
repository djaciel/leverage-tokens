# Technical Documentation - Leverage Token Backtester

This document provides in-depth technical information about the backtester architecture, design decisions, and implementation details.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Why TypeScript?](#why-typescript)
- [Data Extraction System](#data-extraction-system)
- [Simulation Engine](#simulation-engine)
- [Auction Simulator](#auction-simulator)
- [Backtester Orchestrator](#backtester-orchestrator)
- [Multi-Run System](#multi-run-system)
- [Design Decisions](#design-decisions)
- [Testing](#testing)

---

## Architecture Overview

The backtester follows a modular architecture with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────┐
│                    Main Orchestrator                    │
│                     (src/index.ts)                      │
└─────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌──────────────────────┐        ┌──────────────────────┐
│  Data Extraction     │        │   Backtester         │
│  - StrategyExtractor │        │   - Initialize       │
│  - DataManager       │        │   - Run simulation   │
│  - Adapters          │        │   - Calculate metrics│
└──────────────────────┘        └──────────────────────┘
            │                               │
            ▼                               ▼
┌──────────────────────┐        ┌──────────────────────┐
│   Data Storage       │        │  Simulation Engine   │
│   - ETH.json         │        │  - State management  │
│   - weETH.json       │        │  - Interest accrual  │
│   - MORPHO-*.json    │        │  - Fee calculation   │
└──────────────────────┘        │  - Rebalance logic   │
                                └──────────────────────┘
                                            │
                                            ▼
                                ┌──────────────────────┐
                                │  Auction Simulator   │
                                │  - Probabilistic     │
                                │  - Timing simulation │
                                │  - Emergency mode    │
                                └──────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Key Files |
|-----------|---------------|-----------|
| **Main Orchestrator** | Coordinates data extraction and backtesting, handles CLI args | `src/index.ts` |
| **Data Extraction** | Fetches and caches historical price/APY data | `src/data-extraction/` |
| **Simulation Engine** | Replicates on-chain leverage token mechanics | `src/simulation/SimulationEngine.ts` |
| **Auction Simulator** | Models realistic rebalance timing | `src/simulation/AuctionSimulator.ts` |
| **Backtester** | Orchestrates simulation runs and calculates metrics | `src/simulation/Backtester.ts` |

---

## Why TypeScript?

The decision to implement the backtester in TypeScript rather than extending the Solidity contracts was driven by several key requirements:

### 1. Historical Data Access

**Problem**: Smart contracts cannot access historical on-chain data efficiently.

**Solution**: TypeScript can easily fetch data from:
- Binance API (5-minute OHLCV candles)
- DeFiLlama API (on-chain price history)
- Morpho GraphQL API (historical borrow APY)

### 2. Performance and Speed

**Problem**: Running simulations on-chain is slow and complex.

- **Granularity**: 5-minute data points over 4 months or more
- **Iteration speed**: Testing different parameters requires re-deployment

**Solution**: TypeScript runs locally:
- Process multiple time points in seconds
- No gas or RPC costs
- Instant iteration on parameters

### 3. Statistical Analysis

**Problem**: Need to run hundreds of simulations to understand outcome distributions.

- **Monte Carlo**: Running 200+ simulations with different random seeds
- **Aggregation**: Calculate mean, median, P5, P95 across all runs
- **Memory**: Store and analyze large datasets

**Solution**: TypeScript provides:
- Fast iteration for Monte Carlo simulation
- Built-in data structures for aggregation
- Easy integration with statistical libraries

### 4. Identical Logic, Different Environments

**Key insight**: The backtester uses the **exact same formulas** as the Solidity contracts.

Example - Collateral Ratio Calculation:

**Solidity** ([CollateralRatiosRebalanceAdapter.sol](../src/rebalance/CollateralRatiosRebalanceAdapter.sol)):
```solidity
ratio = (collateralAmount * collateralPriceUSD) / (debtAmount * debtPriceUSD)
```

**TypeScript** (SimulationEngine.ts:111):
```typescript
const collateralValue = Number(this.state.collateralAmount) / 1e18 * prices.collateralPriceUSD;
const debtValue = Number(this.state.debtAmount) / 1e18 * prices.debtPriceUSD;
return collateralValue / debtValue;
```

Both implementations produce identical results. TypeScript simply has access to historical data and can run faster.

### 5. Testing and Debugging

**Advantages**:
- Unit tests run in milliseconds (Vitest)
- Easy to debug with standard dev tools
- Can log detailed state at every step
- No need for Foundry/Hardhat overhead

---

## Data Extraction System

The data extraction system fetches and caches historical data using an adapter pattern.

### Architecture

```typescript
StrategyExtractor
    ├─> DataManager (storage + gap detection)
    └─> Adapters
        ├─> BinanceAdapter (debt prices - 5min)
        ├─> DeFiLlamaAdapter (collateral prices - 1hr)
        └─> MorphoAdapter (borrow APY - 1day)
```

### Adapter Pattern

All data sources implement the `IDataAdapter` interface:

```typescript
// src/data-extraction/adapters/base.ts

export interface IDataAdapter {
  readonly name: DataAdapter;

  fetchPriceData(
    asset: AssetConfig,
    timeRange: TimeRange
  ): Promise<PricePoint[]>;

  canHandle(asset: AssetConfig): boolean;
}
```

This allows easy addition of new data sources (Aave, Compound, etc.) without changing core logic.

### Gap Detection Algorithm

The `DataManager` implements intelligent gap detection to avoid re-fetching data:

**Algorithm** (DataManager.ts:63-85):

```typescript
detectGaps(data: PricePoint[], needed: TimeRange): TimeRange[] {
  if (data.length === 0) {
    return [needed];  // No data, need entire range
  }

  const min = data[0].timestamp;
  const max = data[data.length - 1].timestamp;
  const gaps: TimeRange[] = [];

  // Gap before existing data
  if (needed.from < min) {
    gaps.push({ from: needed.from, to: min - 1 });
  }

  // Gap after existing data
  if (needed.to > max) {
    gaps.push({ from: max + 1, to: needed.to });
  }

  return gaps;
}
```

**Benefits**:
- Append-only file structure
- Incremental data fetching
- Reusable across strategies (e.g., `ETH.json` used by multiple strategies)

### Data Adapters

#### 1. Binance Adapter (binance.ts)

Fetches high-frequency price data from Binance CEX.

**Key features**:
- 5-minute candles (uses close price)
- Batched requests (max 1000 candles per request)
- Rate limiting awareness
- Automatic pagination

**Usage**:
```typescript
debt: {
  symbol: 'ETH',
  adapter: DataAdapter.BINANCE,
}
```

**Data format**:
```json
{
  "symbol": "ETH",
  "source": "binance",
  "timeframe": "5m",
  "data": [
    { "timestamp": 1704067200, "price": 2300.50 },
    { "timestamp": 1704067500, "price": 2301.20 }
  ]
}
```

#### 2. DeFiLlama Adapter (defillama.ts)

Fetches on-chain token prices from DeFiLlama.

**Key features**:
- Daily data points (interpolated to hourly)
- Chain + address-based lookup
- Batch fetching (10 timestamps per request to respect API limits)
- Linear interpolation for hourly granularity

**Usage**:
```typescript
collateral: {
  symbol: 'weETH',
  chain: 'base',
  address: '0x04C0599Ae5A44757c0af6F9eC3b93da8976c150A',
  adapter: DataAdapter.DEFILLAMA,
}
```

**Interpolation logic**:
DeFiLlama provides daily prices. We interpolate to hourly to match simulation granularity:

```typescript
// For each daily point, create 24 hourly points
for (let hour = 0; hour < 24; hour++) {
  interpolated.push({
    timestamp: dailyPoint.timestamp + hour * 3600,
    price: dailyPoint.price,  // Forward-fill
  });
}
```

#### 3. Morpho Adapter (morpho.ts)

Fetches borrow APY from Morpho Blue markets via GraphQL API.

**Key features**:
- Market-specific borrow APY
- Daily granularity
- GraphQL query to official Morpho API

**Usage**:
```typescript
lendingMarket: {
  marketId: '0xfd0895ba253889c243bf59bc4b96fd1e06d68631241383947b04d1c293a0cfea',
  adapter: DataAdapter.MORPHO,
  chainId: 8453,
}
```

**GraphQL Query**:
```graphql
query GetMarketBorrowApyTimeseries(
  $uniqueKey: String!,
  $chainId: Int!,
  $options: TimeseriesOptions
) {
  marketByUniqueKey(uniqueKey: $uniqueKey, chainId: $chainId) {
    historicalState {
      dailyNetBorrowApy(options: $options) {
        x  # timestamp
        y  # APY as decimal (e.g., 0.025 = 2.5%)
      }
    }
  }
}
```

### File Naming Convention

Data files use a standardized naming scheme:

| Asset Type | Format | Example |
|------------|--------|---------|
| Debt token | `{SYMBOL}.json` | `ETH.json` |
| Collateral token | `{SYMBOL}.json` | `weETH.json` |
| Lending market | `{ADAPTER}-{MARKET_ID_PREFIX}.json` | `MORPHO-0xfd0895ba.json` |

This ensures:
- Asset data is reusable across strategies
- Market data is uniquely identified
- Easy to understand what each file contains

---

## Simulation Engine

The `SimulationEngine` is the heart of the backtester, replicating the behavior of the on-chain smart contracts.

### State Management

The engine maintains state identical to on-chain contracts:

```typescript
// SimulationEngine.ts:63-69

interface LeverageTokenState {
  collateralAmount: bigint;  // e.g., 17 weETH = 17e18
  debtAmount: bigint;        // e.g., 16 WETH = 16e18
  totalShares: bigint;       // ERC20 total supply
  timestamp: number;         // Current simulation time
}
```

Using `bigint` (instead of `number`) maintains precision equivalent to Solidity's `uint256`.

### Core Calculations

#### 1. Collateral Ratio

**Formula**: `CR = (collateral value USD) / (debt value USD)`

**Implementation** (SimulationEngine.ts:111-123):
```typescript
public calculateCollateralRatio(prices: MarketPrices): number {
  if (this.state.debtAmount === 0n) {
    return Infinity;  // No debt = infinitely safe
  }

  const collateralValue =
    Number(this.state.collateralAmount) / 1e18 * prices.collateralPriceUSD;
  const debtValue =
    Number(this.state.debtAmount) / 1e18 * prices.debtPriceUSD;

  return collateralValue / debtValue;
}
```

**On-chain equivalent**: [MorphoLendingAdapter.sol](../src/lending/MorphoLendingAdapter.sol)::getCollateralRatio()

#### 2. Share Price

**Formula**: `sharePrice = equity / totalShares` where `equity = collateral - debt` (in collateral token terms)

**Implementation** (SimulationEngine.ts:143-160):
```typescript
public calculateSharePrice(prices: MarketPrices): number {
  if (this.state.totalShares === 0n) {
    return 0;
  }

  // Calculate equity in collateral token units
  const collateralNum = Number(this.state.collateralAmount) / 1e18;
  const debtNum = Number(this.state.debtAmount) / 1e18;
  const debtInCollateralUnits = debtNum * (prices.debtPriceUSD / prices.collateralPriceUSD);

  const equityInCollateral = collateralNum - debtInCollateralUnits;
  const sharesNum = Number(this.state.totalShares) / 1e18;

  return equityInCollateral / sharesNum;
}
```

**On-chain equivalent**: [LeverageManager.sol](../src/LeverageManager.sol)::convertToAssets() (lines 194-208)

This follows ERC-4626 vault accounting logic where shares represent proportional claim to equity.

#### 3. Interest Accrual

**Formula**: `newDebt = debt × (1 + APY × timeDelta / SECONDS_PER_YEAR)`

**Implementation** (SimulationEngine.ts:251-267):
```typescript
public accrueInterest(borrowRate: BorrowRate, timeDelta: number): void {
  if (timeDelta <= 0 || this.state.debtAmount === 0n) {
    return;
  }

  const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

  // Linear approximation (accurate for small time deltas)
  const interestMultiplier = 1 + (borrowRate.apy * timeDelta) / SECONDS_PER_YEAR;

  const debtNum = Number(this.state.debtAmount);
  const newDebt = BigInt(Math.floor(debtNum * interestMultiplier));

  this.state.debtAmount = newDebt;
  this.state.timestamp = borrowRate.timestamp;
}
```

**On-chain equivalent**: Morpho Blue's automatic interest accrual

**Note**: We use linear approximation instead of compound interest because our time deltas are small (5 minutes). The error is negligible compared to compound calculation.

#### 4. Management Fee Accrual

**Formula**: `feeShares = totalShares × (feeRate × timeDelta / SECONDS_PER_YEAR)`

**Implementation** (SimulationEngine.ts:205-227):
```typescript
public accrueManagementFee(currentTimestamp: number): void {
  if (this.managementFeePercentage === 0) {
    return;
  }

  const timeElapsed = currentTimestamp - this.lastFeeAccrualTimestamp;
  if (timeElapsed <= 0) return;

  const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;

  // Calculate shares to mint as fee
  const totalSupplyNum = Number(this.state.totalShares);
  const feeMultiplier = (this.managementFeePercentage * timeElapsed) / SECONDS_PER_YEAR;
  const feeShares = totalSupplyNum * feeMultiplier;

  // Mint fee shares (dilutes existing holders)
  this.state.totalShares = this.state.totalShares + BigInt(Math.floor(feeShares));
  this.lastFeeAccrualTimestamp = currentTimestamp;
}
```

**Effect**: Minting new shares to the treasury dilutes existing shareholders, effectively reducing share price proportionally.

**On-chain equivalent**: [FeeManager.sol](../src/FeeManager.sol)::_getAccruedManagementFee() (lines 256-277)

#### 5. Rebalance Execution

**Goal**: Adjust collateral/debt ratio back to target while preserving total value.

**Implementation** (SimulationEngine.ts:356-404):

```typescript
public rebalance(prices: MarketPrices, direction: 'UP' | 'DOWN'): RebalanceResult {
  const stateBefore = { ...this.state };
  const ratioBefore = this.calculateCollateralRatio(prices);

  // Calculate total value in debt terms
  const totalValueInDebtTerms =
    Number(this.state.debtAmount) / 1e18 +
    (Number(this.state.collateralAmount) / 1e18 *
     prices.collateralPriceUSD / prices.debtPriceUSD);

  // Calculate target amounts that preserve value and achieve target ratio
  // Solving: totalValue = targetDebt + targetCollateral * P_c / P_d
  //          AND ratio = targetCollateral * P_c / (targetDebt * P_d) = target
  const targetDebtAmount = totalValueInDebtTerms / (1 + this.config.target);
  const targetCollateralAmount =
    targetDebtAmount * this.config.target *
    prices.debtPriceUSD / prices.collateralPriceUSD;

  // Update state
  this.state.debtAmount = BigInt(Math.floor(targetDebtAmount * 1e18));
  this.state.collateralAmount = BigInt(Math.floor(targetCollateralAmount * 1e18));
  this.state.timestamp = prices.timestamp;

  return { stateBefore, stateAfter: {...this.state}, ... };
}
```

**Key insight**: In the real protocol, the vault does NOT pay for swap slippage. The external rebalancer bot executes swaps and absorbs those costs. The vault only does lending operations (borrow/repay/add/remove collateral).

**On-chain equivalent**: [LeverageManager.sol](../src/LeverageManager.sol)::rebalance() (lines 313-333)

### Rebalance Decision Logic

**When to rebalance** (SimulationEngine.ts:285-319):

```typescript
public checkRebalanceNeeded(prices: MarketPrices): {
  needed: boolean;
  direction?: 'UP' | 'DOWN';
  currentRatio: number;
} {
  const ratio = this.calculateCollateralRatio(prices);

  // Use AuctionSimulator to determine if rebalance should happen
  const auctionResult = this.auctionSimulator.checkRebalance(
    prices.timestamp,
    ratio,
    this.config.min,
    this.config.max
  );

  // If ratio is back in bounds, reset auction state
  if (ratio >= this.config.min && ratio <= this.config.max) {
    this.auctionSimulator.reset();
  }

  return {
    needed: auctionResult.shouldRebalance,
    direction: auctionResult.direction,
    currentRatio: ratio,
  };
}
```

**Important**: The simulation delegates auction timing to the `AuctionSimulator` module, which models realistic delays.

---

## Auction Simulator

The `AuctionSimulator` models the realistic timing and probability of rebalances via Dutch Auctions.

### Why Auction Simulation?

In the real protocol:
1. Someone notices collateral ratio is out of bounds
2. They create a Dutch Auction
3. Auction runs for ~40 minutes with exponential decay pricing
4. An arbitrageur executes when price becomes profitable

This process introduces **non-deterministic delays**. Instant rebalancing would be unrealistic.

### Auction State Machine

```
┌─────────────────────┐
│  Ratio in bounds    │
│  No auction         │
└──────────┬──────────┘
           │
           │ Ratio goes out of bounds
           ▼
┌─────────────────────┐
│  Wait for someone   │
│  to notice          │
│  (probabilistic)    │
└──────────┬──────────┘
           │
           │ Auction created
           ▼
┌─────────────────────┐
│  Auction running    │
│  Price decaying     │
└──────────┬──────────┘
           │
           │ Price becomes favorable
           ▼
┌─────────────────────┐
│  Execute rebalance  │
│  Reset auction      │
└─────────────────────┘
```

### Configuration

Default auction parameters (AuctionSimulator.ts:33-41):

```typescript
export const DEFAULT_AUCTION_CONFIG: AuctionConfig = {
  minNoticeTime: 600,                 // 10 min minimum to notice
  maxNoticeTime: 3600,                // 60 min maximum to notice
  avgAuctionDuration: 2400,           // 40 min average auction duration
  auctionDurationStdDev: 1200,        // 20 min std deviation
  auctionCreationProbability: 0.05,   // 5% chance per 5-min check
  emergencyThreshold: 1.06061,        // Pre-liquidation threshold
  emergencyRebalanceTime: 600,        // 10 min for emergency
};
```

### Auction Creation Logic

**Algorithm** (AuctionSimulator.ts:83-150):

```typescript
public checkRebalance(
  currentTimestamp: number,
  currentRatio: number,
  minRatio: number,
  maxRatio: number
): { shouldRebalance: boolean; direction?: 'UP' | 'DOWN' } {

  // 1. If auction is active and ready to execute
  if (this.activeAuction && currentTimestamp >= this.activeAuction.executeAt) {
    const result = {
      shouldRebalance: true,
      direction: this.activeAuction.direction
    };
    this.activeAuction = null;  // Clear auction
    return result;
  }

  // 2. If auction is in progress, wait
  if (this.activeAuction) {
    return { shouldRebalance: false };
  }

  // 3. Check if ratio is within bounds
  if (currentRatio >= minRatio && currentRatio <= maxRatio) {
    return { shouldRebalance: false };
  }

  // 4. Ratio is out of bounds
  const direction = currentRatio < minRatio ? 'DOWN' : 'UP';

  // 5. Check for emergency (pre-liquidation)
  const isEmergency = currentRatio < this.config.emergencyThreshold;

  if (isEmergency) {
    // Create immediate auction with short duration
    this.activeAuction = {
      createdAt: currentTimestamp,
      executeAt: currentTimestamp + this.config.emergencyRebalanceTime,
      direction,
      isEmergency: true,
    };
    return { shouldRebalance: false };  // Will execute next check
  }

  // 6. Normal case: probabilistic auction creation
  const shouldCreateAuction = this.rng() < this.config.auctionCreationProbability;

  if (shouldCreateAuction) {
    const noticeTime = this.randomBetween(
      this.config.minNoticeTime,
      this.config.maxNoticeTime
    );
    const auctionDuration = this.randomNormal(
      this.config.avgAuctionDuration,
      this.config.auctionDurationStdDev
    );

    this.activeAuction = {
      createdAt: currentTimestamp,
      executeAt: currentTimestamp + noticeTime + Math.max(0, auctionDuration),
      direction,
      isEmergency: false,
    };
  }

  return { shouldRebalance: false };
}
```

### Deterministic Randomness

To enable reproducible results while maintaining realistic variability, the simulator uses **seeded pseudo-random number generation**:

**Implementation** (AuctionSimulator.ts:68-72):
```typescript
constructor(config: Partial<AuctionConfig> = {}, seed?: string) {
  this.config = { ...DEFAULT_AUCTION_CONFIG, ...config };
  // Use provided seed or default to 'auction-simulator' for reproducibility
  this.rng = seedrandom(seed || 'auction-simulator');
}
```

**Benefits**:
- **Single run**: Use strategy name as seed → deterministic, reproducible
- **Multi-run**: Use different seeds (`strategy-run-0`, `strategy-run-1`, ...) → statistical distribution

All `Math.random()` calls are replaced with `this.rng()` to ensure determinism.

### Emergency Rebalancing

**Concept**: When collateral ratio drops below the pre-liquidation threshold, rebalancing becomes urgent.

**Implementation**:
- Normal auction: 10-60 min notice + 20-60 min auction = **30-120 min total**
- Emergency auction: 10 min total (fast-tracked)

This prevents liquidations by prioritizing emergency scenarios.

**Threshold**: Derived from `preLiquidationLeverage` in strategy config.

Example for 17x strategy:
- Target: 17x → CR 1.0625
- Pre-liquidation: 17.5x → CR 1.06061
- Market LLTV: 94.5% → Max allowed 18.9x → CR 1.0556

Emergency triggers when ratio drops to 1.06061, well before liquidation at 1.0556.

---

## Backtester Orchestrator

The `Backtester` class orchestrates the entire simulation process.

### Initialization

**Goal**: Set up initial state matching the on-chain deployment.

**Algorithm** (Backtester.ts:117-202):

```typescript
public initialize(config: BacktestConfig): void {
  const { strategy, initialDepositCollateral } = config;

  // Get first price from backtest range
  const firstDebtPrice = this.historicalData.debtPrices.data
    .find(p => p.timestamp >= strategy.timeRangeBacktest.from);
  const firstCollateralPrice = this.historicalData.collateralPrices.data
    .find(p => p.timestamp >= strategy.timeRangeBacktest.from);

  // Calculate initial state based on target leverage
  // Given:
  //   - equity = initialDepositCollateral (e.g., 1 weETH)
  //   - targetRatio (e.g., 1.0625 for 17x)
  //   - prices (P_weETH, P_ETH)
  //
  // Solving:
  //   equity = collateral - (debt * P_ETH / P_weETH)
  //   ratio = (collateral * P_weETH) / (debt * P_ETH)
  //
  // Results in:
  //   debt = equity * P_weETH / (P_ETH * (targetRatio - 1))
  //   collateral = targetRatio * debt * P_ETH / P_weETH

  const targetRatio = strategy.collateralRatios.target;
  const debtAmount =
    initialDepositCollateral * firstCollateralPrice.price /
    (firstDebtPrice.price * (targetRatio - 1));
  const collateralAmount =
    targetRatio * debtAmount * firstDebtPrice.price / firstCollateralPrice.price;

  // Convert to bigint (18 decimals)
  const initialCollateral = BigInt(Math.floor(collateralAmount * 1e18));
  const initialDebt = BigInt(Math.floor(debtAmount * 1e18));
  const initialShares = BigInt(Math.floor(initialDepositCollateral * 1e18));

  // Initialize simulation engine
  this.engine = new SimulationEngine({
    initialCollateral,
    initialDebt,
    initialShares,
    collateralRatios: strategy.collateralRatios,
    startTimestamp: firstDebtPrice.timestamp,
    estimatedRebalanceGasCost: config.estimatedRebalanceGasCost,
    managementFeePercentage: config.managementFeePercentage,
    ...(config.seed && { seed: config.seed }),
  });
}
```

**Example**: For 1 weETH deposit with 17x leverage:
- Collateral: 17 weETH
- Debt: 16 WETH
- Shares: 1 (representing 1 weETH of equity)

### Simulation Loop

**Goal**: Step through historical data chronologically, updating state at each time point.

**Algorithm** (Backtester.ts:217-316):

```typescript
public async run(): Promise<BacktestResult> {
  // Filter data to backtest range
  const filteredDebtPrices = debtPrices.data
    .filter(p => p.timestamp >= backtestRange.from && p.timestamp <= backtestRange.to);
  const filteredCollateralPrices = collateralPrices.data
    .filter(p => p.timestamp >= backtestRange.from && p.timestamp <= backtestRange.to);
  const filteredBorrowAPY = borrowAPY.data
    .filter(p => p.timestamp >= backtestRange.from && p.timestamp <= backtestRange.to);

  // Merge all timelines into single sorted timeline
  const timeline = this.mergeTimelines(
    filteredDebtPrices,
    filteredCollateralPrices,
    filteredBorrowAPY
  );

  let lastTimestamp = timeline[0]?.timestamp || 0;

  for (const point of timeline) {
    const timeDelta = point.timestamp - lastTimestamp;

    const prices = {
      collateralPriceUSD: point.collateralPrice,
      debtPriceUSD: point.debtPrice,
      timestamp: point.timestamp,
    };

    const borrowRate = {
      apy: point.borrowAPY,
      timestamp: point.timestamp,
    };

    // 1. Accrue management fee (dilutes shares)
    this.engine.accrueManagementFee(point.timestamp);

    // 2. Accrue interest on debt
    if (timeDelta > 0) {
      this.engine.accrueInterest(borrowRate, timeDelta);
    }

    // 3. Update timestamp
    this.engine.updateTimestamp(point.timestamp);

    // 4. Check if rebalance needed
    const rebalanceCheck = this.engine.checkRebalanceNeeded(prices);
    if (rebalanceCheck.needed && rebalanceCheck.direction) {
      const result = this.engine.rebalance(prices, rebalanceCheck.direction);
      rebalances.push(result);
    }

    // 5. Record snapshot
    this.engine.recordSnapshot(prices, borrowRate.apy);

    lastTimestamp = point.timestamp;
  }

  // Calculate final metrics
  const metrics = this.calculateMetrics(this.engine.getHistory(), rebalances);

  return { strategyName, period, metrics, rebalances, history };
}
```

**Order of operations is critical**:
1. Accrue fees first (affects share supply before calculating share price)
2. Accrue interest (affects debt before rebalance check)
3. Check rebalance (uses current state)
4. Record snapshot (captures state after all updates)

### Timeline Merging

**Problem**: Different data sources have different granularities:
- Debt prices: Every 5 minutes
- Collateral prices: Every hour
- Borrow APY: Daily

**Solution**: Merge into single timeline and forward-fill missing values.

**Algorithm** (Backtester.ts:325-367):

```typescript
private mergeTimelines(
  debtPrices: PricePoint[],
  collateralPrices: PricePoint[],
  apyData: PricePoint[]
): Array<{ timestamp, debtPrice, collateralPrice, borrowAPY }> {

  // Get all unique timestamps
  const allTimestamps = new Set([
    ...debtPrices.map(p => p.timestamp),
    ...collateralPrices.map(p => p.timestamp),
    ...apyData.map(p => p.timestamp),
  ]);

  const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

  // Forward-fill missing values
  let lastDebtPrice = 0;
  let lastCollateralPrice = 0;
  let lastAPY = 0;

  return sortedTimestamps.map(timestamp => {
    const debtPrice = debtMap.get(timestamp) || lastDebtPrice;
    const collateralPrice = collateralMap.get(timestamp) || lastCollateralPrice;
    const borrowAPY = apyMap.get(timestamp) || lastAPY;

    lastDebtPrice = debtPrice;
    lastCollateralPrice = collateralPrice;
    lastAPY = borrowAPY;

    return { timestamp, debtPrice, collateralPrice, borrowAPY };
  });
}
```

**Forward-fill strategy**:
- If debt price exists at timestamp: use it
- Else: use last known debt price
- Same for collateral price and APY

This ensures we always have complete data at every time point.

### Metrics Calculation

**Goal**: Calculate performance metrics from simulation history.

**Metrics** (Backtester.ts:372-423):

```typescript
private calculateMetrics(
  history: StateSnapshot[],
  rebalances: RebalanceResult[]
): SimulationMetrics {

  const first = history[0];
  const last = history[history.length - 1];

  // 1. Total Return
  const initialSharePrice = first.sharePrice;
  const finalSharePrice = last.sharePrice;
  const totalReturn = ((finalSharePrice - initialSharePrice) / initialSharePrice) * 100;

  // 2. Annualized Return (CAGR)
  const durationYears = (last.timestamp - first.timestamp) / (365.25 * 24 * 60 * 60);
  const annualizedReturn =
    (Math.pow(finalSharePrice / initialSharePrice, 1 / durationYears) - 1) * 100;

  // 3. Max Drawdown
  let peak = initialSharePrice;
  let maxDrawdown = 0;
  for (const snapshot of history) {
    if (snapshot.sharePrice > peak) {
      peak = snapshot.sharePrice;
    }
    const drawdown = ((peak - snapshot.sharePrice) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  // 4. Collateral Ratio Stats
  const avgCollateralRatio =
    history.reduce((sum, s) => sum + s.collateralRatio, 0) / history.length;
  const timesBelowMin =
    history.filter(s => s.collateralRatio < minRatio).length;
  const timesAboveMax =
    history.filter(s => s.collateralRatio > maxRatio).length;

  // 5. Gas Costs
  const totalGasCostsUSD =
    rebalances.reduce((sum, r) => sum + r.estimatedGasCostUSD, 0);

  return {
    initialSharePrice,
    finalSharePrice,
    totalReturn,
    annualizedReturn,
    maxDrawdown,
    rebalanceCount: rebalances.length,
    totalGasCostsUSD,
    avgCollateralRatio,
    timesBelowMin,
    timesAboveMax,
  };
}
```

**Max Drawdown calculation**:
- Track peak share price
- Calculate drawdown from peak at each point
- Return worst drawdown encountered

---

## Multi-Run System

The multi-run system enables Monte Carlo simulation to understand outcome distributions.

### Architecture

**Single run**:
```
Backtest → Result { metrics, rebalances, history }
```

**Multi-run** (200 runs):
```
for i in 0..200:
  seed = `strategy-run-${i}`
  result = Backtest(seed)
  store only metrics

Aggregate:
  mean, median, P5, P95 across all runs
```

### Statistical Aggregation

**Goal**: Calculate mean, median, percentiles across all runs.

**Implementation** (index.ts:46-89):

```typescript
function calculateStats(results: BacktestResult[]) {
  const metrics = results.map(r => r.metrics);

  const sorted = (key: keyof typeof metrics[0]) =>
    metrics.map(m => m[key] as number).sort((a, b) => a - b);

  const mean = (arr: number[]) =>
    arr.reduce((sum, val) => sum + val, 0) / arr.length;

  const percentile = (arr: number[], p: number) =>
    arr[Math.floor(arr.length * p)];

  const totalReturns = sorted('totalReturn');

  return {
    totalReturn: {
      mean: mean(totalReturns),
      median: percentile(totalReturns, 0.5),
      p5: percentile(totalReturns, 0.05),
      p95: percentile(totalReturns, 0.95),
      min: totalReturns[0],
      max: totalReturns[totalReturns.length - 1],
    },
    // ... same for other metrics
  };
}
```

**P5-P95 range**: Represents the middle 90% of outcomes (excludes extreme outliers).

### Output Verbosity Control

**Problem**: With 200 runs, showing detailed progress for each run creates repetitive, useless output.

**Solution**: Conditional logging based on `showProgress` flag.

**Implementation** (Backtester.ts:222-224):

```typescript
const showProgress = this.config.showProgress !== false; // Default true
const log = (message: string) => showProgress && console.log(message);
const write = (message: string) => showProgress && process.stdout.write(message);

// Usage:
log(`🚀 Running backtest...`);
write(`\r   Progress: ${percent}%`);
```

**Result**:
- Single run: Full detailed output
- Multi-run: Only overall progress (e.g., "Progress: 50%")

---

## Design Decisions

### 1. Why not store weETH/ETH ratio directly?

**Decision**: Store absolute prices (weETH USD, ETH USD), calculate ratio on-demand.

**Rationale**:
- **Flexibility**: Can change ratio calculation in simulation without re-fetching data
- **Reusability**: ETH.json is used by multiple strategies
- **No redundancy**: Don't store derived data that can be computed
- **Accuracy**: Calculating from USD prices matches on-chain oracle behavior

### 2. Why use 5-minute granularity for debt prices?

**Decision**: Fetch 5-minute Binance candles for debt token.

**Rationale**:
- **Auction timing**: Auctions can execute at any time within ~40 min window
- **Precision**: Higher granularity captures rapid price movements
- **Realism**: Simulates realistic rebalance opportunities
- **Storage cost**: Minimal

**Alternative considered**: Hourly data
- **Rejected**: Would miss intra-hour volatility that triggers rebalances

### 3. Why interpolate DeFiLlama data to hourly?

**Decision**: DeFiLlama returns daily data, we interpolate to hourly.

**Rationale**:
- **API limitation**: DeFiLlama doesn't provide sub-daily historical data
- **Good enough**: LST ratios (weETH/ETH) move slowly, daily → hourly interpolation is accurate
- **Consistency**: Matches simulation granularity
- **Forward-fill**: Simple linear interpolation (hold value constant between daily points)

**Alternative considered**: Keep daily data, forward-fill to 5-min
- **Rejected**: Unnecessarily granular given slow-moving nature of LST ratios

### 4. Why separate timeRangeData and timeRangeBacktest?

**Decision**: Strategy config has two time ranges.

**Rationale**:
- **timeRangeData**: Fetch data for this range (e.g., Jan 1 - Oct 5)
- **timeRangeBacktest**: Run simulation for this range (e.g., Jun 5 - Oct 5)

**Use case**:
- Fetch more data than needed (for warm-up period)
- Backtest on specific subset (avoid incomplete data at edges)
- Easily test different backtest windows without re-fetching data

### 5. Why use bigint for token amounts?

**Decision**: Use TypeScript `bigint` instead of `number`.

**Rationale**:
- **Precision**: Matches Solidity `uint256` precision
- **No rounding errors**: Integer arithmetic prevents floating-point issues
- **Compatibility**: Easy to convert to/from Solidity if needed

**Trade-off**: Slightly more verbose code (must convert to `number` for math operations)

### 6. Why separate Auction Simulator from Simulation Engine?

**Decision**: Auction timing is a separate module.

**Rationale**:
- **Separation of concerns**: Core simulation logic vs. probabilistic timing
- **Testability**: Can test auction logic independently
- **Configurability**: Easy to adjust auction parameters without touching core logic
- **Realism**: Models real-world delays without cluttering state machine

### 7. Why use seedrandom instead of Math.random()?

**Decision**: Use seeded PRNG (seedrandom library).

**Rationale**:
- **Reproducibility**: Same seed = same results
- **Debugging**: Can reproduce specific runs that fail
- **Statistical analysis**: Can run Monte Carlo with different seeds but deterministic behavior
- **Comparison**: Can compare strategy changes with identical random sequences

**Implementation**: All `Math.random()` calls replaced with `this.rng()`.

### 8. Why store results with timestamp in filename?

**Decision**: Filename format `strategy-chain-YYYY-MM-DD-HH-MM.json`

**Rationale**:
- **No overwrites**: Each run creates new file
- **Easy comparison**: Can see evolution of strategy over time
- **Chain clarity**: Know which chain the results are for
- **Sortable**: Chronological ordering in file system

**Example**: `weETH-WETH-17x-base-2025-10-08-14-30.json`

---

## Testing

The backtester includes basic unit tests using Vitest.

### Test Structure

```
src/simulation/__tests__/
├── AuctionSimulator.test.ts      # Auction timing and probability
├── SimulationEngine.test.ts      # Core calculations
└── Backtester.test.ts            # End-to-end simulation
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run with UI
pnpm test:ui

# Run specific test file
pnpm test AuctionSimulator
```

### Test Coverage

**AuctionSimulator.test.ts** (7 tests):
- Auction creation probability
- Emergency fast-track
- Auction expiration
- Normal vs emergency timing
- Deterministic seed behavior

**SimulationEngine.test.ts** (11 tests):
- Collateral ratio calculation
- Share price calculation
- Interest accrual
- Management fee accrual
- Rebalance execution (UP and DOWN)
- State transitions

**Backtester.test.ts** (7 tests):
- Initialization with correct state
- Price increase/decrease scenarios
- Rebalance triggering
- Metrics calculation
- End-to-end happy path

---

## Future Enhancements

### Potential Improvements

1. **More data adapters**:
   - Aave lending markets
   - Compound lending markets
   - Uniswap V3 TWAP prices

2. **Advanced metrics**:
   - Sharpe ratio
   - Sortino ratio
   - Volatility (std deviation)
   - Correlation with ETH price

3. **Slippage modeling**:
   - Price impact estimation

4. **Gas optimization**:
   - Dynamic gas price history
   - Rebalance profitability threshold

5. **Visualization**:
   - Share price charts
   - Collateral ratio heat maps
   - Rebalance timing distribution
   - Drawdown visualization

6. **Strategy optimization**:
   - Grid search over parameter space
   - Genetic algorithms for optimal bounds
   - Backtest-driven strategy generation

---

## References

### Smart Contracts

- [CollateralRatiosRebalanceAdapter.sol](../src/rebalance/CollateralRatiosRebalanceAdapter.sol) - Rebalance eligibility logic
- [DutchAuctionRebalanceAdapter.sol](../src/rebalance/DutchAuctionRebalanceAdapter.sol) - Auction mechanics
- [LeverageManager.sol](../src/LeverageManager.sol) - Core vault logic
- [FeeManager.sol](../src/FeeManager.sol) - Fee accrual logic
