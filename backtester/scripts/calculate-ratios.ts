/**
 * Calculate collateral ratios for a leverage token strategy
 *
 * Usage: STRATEGY=weETH-WETH-17x ts-node scripts/calculate-ratios.ts
 */

import { getStrategy } from '../src/strategies';

/**
 * Convert leverage to collateral ratio
 * Formula: CR = leverage / (leverage - 1)
 */
function leverageToCollateralRatio(leverage: number): number {
  return leverage / (leverage - 1);
}

/**
 * Convert collateral ratio to leverage
 * Formula: leverage = CR / (CR - 1)
 */
function collateralRatioToLeverage(collateralRatio: number): number {
  return collateralRatio / (collateralRatio - 1);
}

/**
 * Calculate collateral ratios from leverage configuration
 */
function calculateCollateralRatios(
  leverageTarget: number,
  leverageMin: number,
  leverageMax: number,
  preLiquidationLeverage: number,
  marketLltv: number
) {
  // Convert leverage to collateral ratios
  // Note: min leverage → max CR, max leverage → min CR (inverse relationship)
  const target = leverageToCollateralRatio(leverageTarget);
  const min = leverageToCollateralRatio(leverageMax);  // max leverage → min CR
  const max = leverageToCollateralRatio(leverageMin);  // min leverage → max CR
  const preLiquidationThreshold = leverageToCollateralRatio(preLiquidationLeverage);

  // Validations
  if (min < preLiquidationThreshold) {
    console.warn(
      `⚠️  WARNING: Min collateral ratio (${min.toFixed(6)}) is below preLiquidation threshold (${preLiquidationThreshold.toFixed(6)})`
    );
    console.warn(`   This means normal rebalancing (at ${leverageMax}x) might trigger emergency pre-liquidation rebalances (at ${preLiquidationLeverage}x).`);
    console.warn(`   Consider reducing max leverage or increasing preLiquidationLeverage.`);
  }

  const marketMinLtv = 1 / min;
  if (marketLltv < marketMinLtv) {
    console.error(
      `❌ ERROR: Market LLTV (${(marketLltv * 100).toFixed(2)}%) is less than required min LTV (${(marketMinLtv * 100).toFixed(2)}%)`
    );
    console.error(`   The market cannot support ${leverageMax}x leverage. Reduce max leverage or find a higher LLTV market.`);
    process.exit(1);
  }

  return {
    min,
    target,
    max,
    preLiquidationThreshold,
    // Derived info for display
    targetLtv: 1 - (1 / target),
    minLtv: 1 - (1 / min),
    maxLtv: 1 - (1 / max),
    preLiquidationLtv: 1 - (1 / preLiquidationThreshold),
  };
}

/**
 * Format ratio for copy-paste into strategy file
 */
function formatRatiosForCopyPaste(ratios: ReturnType<typeof calculateCollateralRatios>) {
  return `  collateralRatios: {
    min: ${ratios.min},
    target: ${ratios.target},
    max: ${ratios.max},
    preLiquidationThreshold: ${ratios.preLiquidationThreshold},
  },`;
}

/**
 * Main execution
 */
async function main() {
  const strategyName = process.env.STRATEGY;

  if (!strategyName) {
    console.error('❌ ERROR: STRATEGY environment variable is required');
    console.error('Usage: STRATEGY=weETH-WETH-17x ts-node scripts/calculate-ratios.ts');
    process.exit(1);
  }

  console.log(`\n📊 Calculating Collateral Ratios\n`);
  console.log(`Strategy: ${strategyName}\n`);

  // Load strategy
  const strategy = getStrategy(strategyName);

  // Extract parameters
  const { leverage, lendingMarket } = strategy;
  const { lltv: marketLltv, preLiquidationLeverage } = lendingMarket;

  console.log(`📋 Input Parameters:`);
  console.log(`   Leverage Target: ${leverage.target}x`);
  console.log(`   Leverage Min: ${leverage.min}x (more conservative)`);
  console.log(`   Leverage Max: ${leverage.max}x (more aggressive)`);
  console.log(`   Pre-liquidation Leverage: ${preLiquidationLeverage}x`);
  console.log(`   Market LLTV: ${(marketLltv * 100).toFixed(2)}%`);
  console.log(`   Market ID: ${lendingMarket.marketId.slice(0, 10)}...`);
  console.log(`   Chain: ${lendingMarket.chainId}\n`);

  // Calculate ratios
  const ratios = calculateCollateralRatios(
    leverage.target,
    leverage.min,
    leverage.max,
    preLiquidationLeverage,
    marketLltv
  );

  // Display results
  console.log(`📊 Calculated Collateral Ratios:\n`);
  console.log(`   Target:                    ${ratios.target.toFixed(9)} (${leverage.target}x leverage, LTV: ${(ratios.targetLtv * 100).toFixed(2)}%)`);
  console.log(`   Min:                       ${ratios.min.toFixed(9)} (${leverage.max}x leverage, LTV: ${(ratios.minLtv * 100).toFixed(2)}%)`);
  console.log(`   Max:                       ${ratios.max.toFixed(9)} (${leverage.min}x leverage, LTV: ${(ratios.maxLtv * 100).toFixed(2)}%)`);
  console.log(`   Pre-liquidation Threshold: ${ratios.preLiquidationThreshold.toFixed(9)} (${preLiquidationLeverage}x leverage, LTV: ${(ratios.preLiquidationLtv * 100).toFixed(2)}%)\n`);

  console.log(`✅ Validation:`);
  console.log(`   min <= target <= max: ${ratios.min <= ratios.target && ratios.target <= ratios.max ? '✓' : '✗'}`);
  console.log(`   min >= preLiquidation: ${ratios.min >= ratios.preLiquidationThreshold ? '✓' : '✗'}`);
  console.log(`   market supports min LTV: ${marketLltv >= (1 / ratios.min) ? '✓' : '✗'}\n`);

  console.log(`📋 Copy-paste into strategy file:\n`);
  console.log(formatRatiosForCopyPaste(ratios));
  console.log();
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
