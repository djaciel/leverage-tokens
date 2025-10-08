/**
 * Main orchestrator - runs data extraction then backtest
 *
 * Usage:
 *   STRATEGY=weETH-WETH-17x pnpm start
 */

import { promises as fs } from 'fs';
import path from 'path';
import { StrategyExtractor } from './data-extraction/strategy-extractor';
import { Backtester, HistoricalData, BacktestConfig } from './simulation/Backtester';
import { getStrategy } from './strategies';
import { AssetData } from './types/data-sources';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const strategyName = process.env.STRATEGY || 'weETH-WETH-17x';
  const extractOnly = process.argv.includes('--extract-only');
  const dataDir = './data';
  const resultsDir = './results';

  if (extractOnly) {
    console.log(`\n📥 Data Extraction Only\n`);
  } else {
    console.log(`\n🎯 Leverage Token Backtester\n`);
  }
  console.log(`📋 Strategy: ${strategyName}\n`);

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

  // 4. Run backtest
  const backtester = new Backtester();
  backtester.loadData(historicalData);

  const config: BacktestConfig = {
    strategy,
    initialDepositCollateral: 1.0,
    estimatedRebalanceGasCost: 5,
    managementFeePercentage: 0.02,
  };

  backtester.initialize(config);

  const result = await backtester.run();

  // 5. Display results
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 BACKTEST RESULTS - ${result.strategyName}`);
  console.log(`${'='.repeat(60)}\n`);

  console.log(`📅 Period:`);
  console.log(`   Start: ${new Date(result.period.start * 1000).toISOString().split('T')[0]}`);
  console.log(`   End:   ${new Date(result.period.end * 1000).toISOString().split('T')[0]}`);
  console.log(`   Duration: ${result.period.durationDays.toFixed(1)} days\n`);

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

  // 6. Save results
  await fs.mkdir(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const resultsPath = path.join(resultsDir, `${strategyName}-${timestamp}.json`);
  await fs.writeFile(resultsPath, JSON.stringify(result, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , 2));

  console.log(`💾 Results saved to: ${resultsPath}\n`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
