/**
 * Main orchestrator - runs data extraction then backtest
 *
 * Usage:
 *   STRATEGY=weETH-WETH-17x pnpm start                # Single run with deterministic seed
 *   STRATEGY=weETH-WETH-17x pnpm start --runs=200     # Multiple runs with aggregated statistics
 */

import { promises as fs } from 'fs';
import path from 'path';
import { StrategyExtractor } from './data-extraction/strategy-extractor';
import { Backtester, HistoricalData, BacktestConfig, BacktestResult } from './simulation/Backtester';
import { getStrategy } from './strategies';
import { AssetData, CHAIN_ID_TO_NAME } from './types/data-sources';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse runs flag from command line args
 * Format: --runs=200
 */
function getRunCount(): number | null {
  const arg = process.argv.find(a => a.startsWith('--runs='));
  if (!arg) return null;

  const parts = arg.split('=');
  if (parts.length < 2) return null;

  const runs = parseInt(parts[1]!, 10);
  if (isNaN(runs) || runs < 2) {
    throw new Error('Runs must be >= 2');
  }
  return runs;
}

/**
 * Calculate statistics from multiple backtest results
 */
function calculateStats(results: BacktestResult[]) {
  const metrics = results.map(r => r.metrics);

  const sorted = (key: keyof typeof metrics[0]) => metrics.map(m => m[key] as number).sort((a, b) => a - b);
  const mean = (arr: number[]) => arr.length > 0 ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
  const percentile = (arr: number[], p: number) => arr.length > 0 ? arr[Math.floor(arr.length * p)]! : 0;

  const totalReturns = sorted('totalReturn');
  const annualizedReturns = sorted('annualizedReturn');
  const maxDrawdowns = sorted('maxDrawdown');
  const rebalanceCounts = sorted('rebalanceCount');
  const gasCosts = sorted('totalGasCostsUSD');

  return {
    totalReturn: {
      mean: mean(totalReturns),
      median: percentile(totalReturns, 0.5),
      p5: percentile(totalReturns, 0.05),
      p95: percentile(totalReturns, 0.95),
      min: totalReturns[0] || 0,
      max: totalReturns[totalReturns.length - 1] || 0,
    },
    annualizedReturn: {
      mean: mean(annualizedReturns),
      median: percentile(annualizedReturns, 0.5),
      p5: percentile(annualizedReturns, 0.05),
      p95: percentile(annualizedReturns, 0.95),
    },
    maxDrawdown: {
      mean: mean(maxDrawdowns),
      median: percentile(maxDrawdowns, 0.5),
      p5: percentile(maxDrawdowns, 0.05),
      p95: percentile(maxDrawdowns, 0.95),
    },
    rebalanceCount: {
      mean: mean(rebalanceCounts),
      median: percentile(rebalanceCounts, 0.5),
    },
    totalGasCosts: {
      mean: mean(gasCosts),
      median: percentile(gasCosts, 0.5),
    },
  };
}

/**
 * Run a single backtest
 */
async function runSingleBacktest(
  historicalData: HistoricalData,
  config: BacktestConfig,
  seed?: string
): Promise<BacktestResult> {
  const backtester = new Backtester();
  backtester.loadData(historicalData);
  backtester.initialize(seed ? { ...config, seed } : config);
  return await backtester.run();
}

async function main() {
  const strategyName = process.env.STRATEGY || 'weETH-WETH-17x';
  const extractOnly = process.argv.includes('--extract-only');
  const runCount = getRunCount();
  const dataDir = './data';
  const resultsDir = './results';

  if (extractOnly) {
    console.log(`\n📥 Data Extraction Only\n`);
  } else {
    console.log(`\n🎯 Leverage Token Backtester\n`);
  }
  console.log(`📋 Strategy: ${strategyName}`);
  if (runCount) {
    console.log(`🔄 Runs: ${runCount} (with aggregated statistics)\n`);
  } else {
    console.log(`🔄 Mode: Single run (deterministic)\n`);
  }

  // 1. Load strategy
  const strategy = getStrategy(strategyName);

  // 2. Check if data exists
  const debtPath = path.join(dataDir, `${strategy.debt.symbol}.json`);
  const collateralPath = path.join(dataDir, `${strategy.collateral.symbol}.json`);
  const morphoMarketFile = `MORPHO-${strategy.lendingMarket.marketId.substring(0, 10)}`;
  const borrowAPYPath = path.join(dataDir, `${morphoMarketFile}.json`);

  const [debtExists, collateralExists, borrowAPYExists] = await Promise.all([
    fileExists(debtPath),
    fileExists(collateralPath),
    fileExists(borrowAPYPath),
  ]);

  const needsExtraction = !debtExists || !collateralExists || !borrowAPYExists;

  if (needsExtraction || extractOnly) {
    if (extractOnly) {
      console.log(`🔄 Forcing data extraction...\n`);
    } else {
      console.log(`⚠️  Missing data files - extracting...\n`);
      if (!debtExists) console.log(`   Missing: ${strategy.debt.symbol}.json`);
      if (!collateralExists) console.log(`   Missing: ${strategy.collateral.symbol}.json`);
      if (!borrowAPYExists) console.log(`   Missing: ${morphoMarketFile}.json`);
      console.log('');
    }

    console.log(`📅 Time Range:`);
    console.log(`   From: ${new Date(strategy.timeRangeData.from * 1000).toISOString().split('T')[0]}`);
    console.log(`   To:   ${new Date(strategy.timeRangeData.to * 1000).toISOString().split('T')[0]}\n`);

    // Extract data
    const extractor = new StrategyExtractor(strategy, dataDir);
    await extractor.extract(strategy, strategy.timeRangeData);

    console.log(`\n✅ Data extraction complete!\n`);
    console.log(`📁 Data saved to: ${dataDir}/`);
    console.log(`   - ${strategy.debt.symbol}.json`);
    console.log(`   - ${strategy.collateral.symbol}.json`);
    console.log(`   - ${morphoMarketFile}.json\n`);

    if (extractOnly) {
      console.log(`✨ Done!\n`);
      return; // Exit early if only extracting
    }
  } else {
    console.log(`✅ All data files found\n`);
  }

  // 3. Load data
  console.log(`📂 Loading historical data...`);
  const [debtData, collateralData, borrowAPYData] = await Promise.all([
    fs.readFile(debtPath, 'utf-8'),
    fs.readFile(collateralPath, 'utf-8'),
    fs.readFile(borrowAPYPath, 'utf-8'),
  ]);

  const historicalData: HistoricalData = {
    debtPrices: JSON.parse(debtData) as AssetData,
    collateralPrices: JSON.parse(collateralData) as AssetData,
    borrowAPY: JSON.parse(borrowAPYData) as AssetData,
  };

  console.log(`   ✓ ${strategy.debt.symbol}: ${historicalData.debtPrices.data.length} price points`);
  console.log(`   ✓ ${strategy.collateral.symbol}: ${historicalData.collateralPrices.data.length} price points`);
  console.log(`   ✓ ${morphoMarketFile}: ${historicalData.borrowAPY.data.length} APY points\n`);

  // 4. Configure backtest
  const config: BacktestConfig = {
    strategy,
    initialDepositCollateral: 1.0,
    estimatedRebalanceGasCost: 5,
    managementFeePercentage: 0.02,
  };

  // 5. Run backtest(s)
  let results: BacktestResult[];
  let metricsOnly: Array<{ metrics: any, rebalanceCount: number }> = [];

  if (runCount) {
    // Multiple runs with different seeds
    console.log(`🔄 Running ${runCount} simulations...\n`);

    // Store only metrics to avoid memory issues with large run counts
    let periodInfo: { start: number; end: number; durationDays: number } | null = null;

    // Disable detailed progress for multi-run
    const multiRunConfig = { ...config, showProgress: false };

    for (let i = 0; i < runCount; i++) {
      const seed = `${strategyName}-run-${i}`;
      const result = await runSingleBacktest(historicalData, multiRunConfig, seed);

      // Save period from first run
      if (i === 0) {
        periodInfo = result.period;
      }

      // Extract only metrics and discard heavy data (history, rebalances)
      metricsOnly.push({
        metrics: result.metrics,
        rebalanceCount: result.rebalances.length,
      });

      // Show progress
      if ((i + 1) % Math.max(1, Math.floor(runCount / 10)) === 0) {
        console.log(`   Progress: ${Math.floor(((i + 1) / runCount) * 100)}%`);
      }
    }
    console.log(`   Progress: 100% ✓\n`);

    // Reconstruct minimal results array for stats calculation
    results = metricsOnly.map(m => ({
      strategyName,
      period: periodInfo!,
      metrics: m.metrics,
      rebalances: [],
      history: []
    }) as BacktestResult);
  } else {
    // Single run with deterministic seed
    const result = await runSingleBacktest(historicalData, config, strategyName);
    results = [result];
  }

  // 6. Display results
  const firstResult = results[0]!;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 BACKTEST RESULTS - ${firstResult.strategyName}`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`📅 Period:`);
  console.log(`   Start: ${new Date(firstResult.period.start * 1000).toISOString().split('T')[0]}`);
  console.log(`   End:   ${new Date(firstResult.period.end * 1000).toISOString().split('T')[0]}`);
  console.log(`   Duration: ${firstResult.period.durationDays.toFixed(1)} days\n`);

  if (runCount) {
    // Show aggregated statistics
    const stats = calculateStats(results);

    console.log(`💰 Performance (${runCount} runs):`);
    console.log(`   Total Return:`);
    console.log(`     Mean:   ${stats.totalReturn.mean.toFixed(2)}%`);
    console.log(`     Median: ${stats.totalReturn.median.toFixed(2)}%`);
    console.log(`     Range:  ${stats.totalReturn.min.toFixed(2)}% - ${stats.totalReturn.max.toFixed(2)}%`);
    console.log(`     P5-P95: ${stats.totalReturn.p5.toFixed(2)}% - ${stats.totalReturn.p95.toFixed(2)}%\n`);

    console.log(`   Annualized Return:`);
    console.log(`     Mean:   ${stats.annualizedReturn.mean.toFixed(2)}%`);
    console.log(`     Median: ${stats.annualizedReturn.median.toFixed(2)}%`);
    console.log(`     P5-P95: ${stats.annualizedReturn.p5.toFixed(2)}% - ${stats.annualizedReturn.p95.toFixed(2)}%\n`);

    console.log(`   Max Drawdown:`);
    console.log(`     Mean:   ${stats.maxDrawdown.mean.toFixed(2)}%`);
    console.log(`     Median: ${stats.maxDrawdown.median.toFixed(2)}%`);
    console.log(`     P5-P95: ${stats.maxDrawdown.p5.toFixed(2)}% - ${stats.maxDrawdown.p95.toFixed(2)}%\n`);

    console.log(`🔄 Rebalancing:`);
    console.log(`   Total Rebalances (median): ${Math.round(stats.rebalanceCount.median)}`);
    console.log(`   Gas Costs (median):        $${stats.totalGasCosts.median.toFixed(2)}\n`);
  } else {
    // Show single run results
    const result = firstResult;

    console.log(`💰 Performance:`);
    console.log(`   Initial Share Price: ${result.metrics.initialSharePrice.toFixed(6)} ${strategy.collateral.symbol}`);
    console.log(`   Final Share Price:   ${result.metrics.finalSharePrice.toFixed(6)} ${strategy.collateral.symbol}`);
    console.log(`   Total Return:        ${result.metrics.totalReturn.toFixed(2)}%`);
    console.log(`   Annualized Return:   ${result.metrics.annualizedReturn.toFixed(2)}%`);
    console.log(`   Max Drawdown:        ${result.metrics.maxDrawdown.toFixed(2)}%\n`);

    console.log(`🔄 Rebalancing:`);
    console.log(`   Total Rebalances:    ${result.metrics.rebalanceCount}`);
    console.log(`   Gas Costs (est):     $${result.metrics.totalGasCostsUSD.toFixed(2)}`);
    console.log(`   Avg Collateral Ratio: ${result.metrics.avgCollateralRatio.toFixed(6)}`);
    console.log(`   Times Below Min:     ${result.metrics.timesBelowMin}`);
    console.log(`   Times Above Max:     ${result.metrics.timesAboveMax}\n`);

    if (result.rebalances.length > 0) {
      console.log(`📜 Rebalance History (first 10):`);
      result.rebalances.slice(0, 10).forEach((rebalance, idx) => {
        const date = new Date(rebalance.stateBefore.timestamp * 1000).toISOString().split('T')[0];
        console.log(`   ${idx + 1}. ${date} - ${rebalance.direction} (${rebalance.ratioBefore.toFixed(4)} → ${rebalance.ratioAfter.toFixed(4)})`);
      });
      if (result.rebalances.length > 10) {
        console.log(`   ... and ${result.rebalances.length - 10} more\n`);
      } else {
        console.log('');
      }
    }
  }

  // 7. Save results with improved filename: strategy-chain-date-time.json
  await fs.mkdir(resultsDir, { recursive: true });

  const now = new Date();
  const date = now.toISOString().split('T')[0]; // YYYY-MM-DD
  const time = now.toTimeString().slice(0, 5).replace(':', '-'); // HH-MM
  const chainName = CHAIN_ID_TO_NAME[strategy.lendingMarket.chainId] || `chain-${strategy.lendingMarket.chainId}`;

  const baseFilename = `${strategyName}-${chainName}-${date}-${time}`;

  if (runCount) {
    // Save aggregated stats
    const statsPath = path.join(resultsDir, `${baseFilename}-stats.json`);
    const stats = calculateStats(results);
    await fs.writeFile(statsPath, JSON.stringify({
      strategyName,
      chainName,
      runs: runCount,
      period: firstResult.period,
      statistics: stats,
    }, null, 2));

    console.log(`💾 Statistics saved to: ${statsPath}\n`);

    // Save individual run metrics (without history to save memory)
    const allRunsPath = path.join(resultsDir, `${baseFilename}-all-runs.json`);
    await fs.writeFile(allRunsPath, JSON.stringify({
      runs: metricsOnly
    }, null, 2));

    console.log(`💾 All runs metrics saved to: ${allRunsPath}\n`);
  } else {
    // Save single run
    const resultsPath = path.join(resultsDir, `${baseFilename}.json`);
    await fs.writeFile(resultsPath, JSON.stringify(firstResult, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));

    console.log(`💾 Results saved to: ${resultsPath}\n`);
  }

  console.log(`${'='.repeat(60)}\n`);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
