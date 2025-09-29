/**
 * Dynamic confidence calculation utility for cryptocurrency analysis
 * Calculates confidence based on multiple market factors and data quality
 */

export interface MarketData {
  price_usd: string | number;
  percent_change_24h: string | number;
  percent_change_7d: string | number;
  volume24: string | number;
  market_cap_usd: string | number;
  rank: string | number;
  last_updated?: string;
}

export interface ConfidenceFactors {
  dataQuality: number;      // 0-100: How complete and recent the data is
  marketStability: number;  // 0-100: How stable the market conditions are
  liquidityScore: number;   // 0-100: Trading volume and market cap factors
  rankingScore: number;     // 0-100: Market position and credibility
  volatilityScore: number;  // 0-100: Price stability (inverse of volatility)
}

/* ----------  NEVER-PURGED COLOUR CLASSES  ---------- */
const COLOUR_MAP = {
  green: 'text-green-500 border-green-500 bg-green-500/10',
  blue:  'text-blue-500 border-blue-500 bg-blue-500/10',
  orange:'text-orange-500 border-orange-500 bg-orange-500/10',
  red:   'text-red-500 border-red-500 bg-red-500/10',
} as const;

/* ---------------------------------------------------- */
export function calculateConfidence(data: MarketData): {
  confidence: number;
  factors: ConfidenceFactors;
  reasoning: string[];
} {
  const factors: ConfidenceFactors = {
    dataQuality: 0,
    marketStability: 0,
    liquidityScore: 0,
    rankingScore: 0,
    volatilityScore: 0,
  };
  const reasoning: string[] = [];

  const price = Number(data.price_usd) || 0;
  const change24h = Number(data.percent_change_24h) || 0;
  const change7d = Number(data.percent_change_7d) || 0;
  const volume = Number(data.volume24) || 0;
  const marketCap = Number(data.market_cap_usd) || 0;
  const rank = Number(data.rank) || 999;

  /* 1. Data Quality */
  let dataPoints = 0;
  [price, change24h, change7d, volume, marketCap].forEach(v => v && dataPoints++);
  if (rank > 0 && rank < 999) dataPoints++;
  factors.dataQuality = (dataPoints / 6) * 100;
  reasoning.push(
    factors.dataQuality >= 90 ? 'Complete market data available'
    : factors.dataQuality >= 70 ? 'Most market data available'
    : 'Limited market data available'
  );

  /* 2. Market Stability */
  const volatility = (Math.abs(change24h) + Math.abs(change7d)) / 2;
  if (volatility <= 5) { factors.marketStability = 90; reasoning.push('Low volatility indicates stable conditions'); }
  else if (volatility <= 15) { factors.marketStability = 70; reasoning.push('Moderate volatility in recent periods'); }
  else if (volatility <= 30) { factors.marketStability = 50; reasoning.push('High volatility may affect prediction accuracy'); }
  else { factors.marketStability = 25; reasoning.push('Extreme volatility reduces prediction reliability'); }

  /* 3. Liquidity Score */
  if (marketCap > 0 && volume > 0) {
    const ratio = (volume / marketCap) * 100;
    if (ratio >= 10) { factors.liquidityScore = 95; reasoning.push('Excellent liquidity with high trading volume'); }
    else if (ratio >= 5) { factors.liquidityScore = 80; reasoning.push('Good liquidity for reliable analysis'); }
    else if (ratio >= 1) { factors.liquidityScore = 60; reasoning.push('Moderate liquidity may affect accuracy'); }
    else { factors.liquidityScore = 30; reasoning.push('Low liquidity reduces analysis confidence'); }
  } else {
    factors.liquidityScore = 20; reasoning.push('Insufficient volume/market cap data');
  }

  /* 4. Ranking Score */
  if (rank <= 10) { factors.rankingScore = 95; reasoning.push('Top 10 cryptocurrency with high credibility'); }
  else if (rank <= 50) { factors.rankingScore = 85; reasoning.push('Well-established cryptocurrency'); }
  else if (rank <= 100) { factors.rankingScore = 70; reasoning.push('Established mid-cap cryptocurrency'); }
  else if (rank <= 500) { factors.rankingScore = 50; reasoning.push('Lower-cap asset with higher uncertainty'); }
  else { factors.rankingScore = 25; reasoning.push('Very low market cap increases prediction risk'); }

  /* 5. Volatility Score (inverse) */
  factors.volatilityScore = Math.max(0, 100 - volatility * 2);

  /* Final weighted confidence */
  const weights = { dataQuality: 0.25, marketStability: 0.20, liquidityScore: 0.20, rankingScore: 0.20, volatilityScore: 0.15 };
  const confidence = Math.round(
    factors.dataQuality * weights.dataQuality +
    factors.marketStability * weights.marketStability +
    factors.liquidityScore * weights.liquidityScore +
    factors.rankingScore * weights.rankingScore +
    factors.volatilityScore * weights.volatilityScore
  );
  const finalConfidence = Math.max(15, Math.min(95, confidence));

  return { confidence: finalConfidence, factors, reasoning };
}

/* ---------------------------------------------------- */
export function getConfidenceDescription(confidence: number): string {
  if (confidence >= 85) return 'Very High';
  if (confidence >= 70) return 'High';
  if (confidence >= 55) return 'Moderate';
  if (confidence >= 40) return 'Low';
  return 'Very Low';
}

/* ---------------------------------------------------- */
export function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return COLOUR_MAP.green;
  if (confidence >= 60) return COLOUR_MAP.blue;
  if (confidence >= 40) return COLOUR_MAP.orange;
  return COLOUR_MAP.red;
}

/* ---------------------------------------------------- */
export function calculateChatConfidence(
  questionComplexity: 'simple' | 'moderate' | 'complex',
  hasMarketData = true,
  isRealTimeData = true
): number {
  let base = questionComplexity === 'simple' ? 85
           : questionComplexity === 'moderate' ? 70
           : 55;
  if (!hasMarketData) base -= 20;
  if (!isRealTimeData) base -= 10;
  const variation = (Math.random() - 0.5) * 10; // ±5 %
  return Math.max(25, Math.min(90, Math.round(base + variation)));
}