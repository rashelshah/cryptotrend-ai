import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Target,
  Clock,
  Sparkles,
  RefreshCw
} from 'lucide-react';
import { geminiAI, AIAnalysis } from '@/lib/gemini';
import { calculateConfidence, type MarketData } from '@/utils/confidenceCalculator';
import { getHistoricalData } from '@/lib/coinlore';
import { fitLinearRegression, indexX } from '@/utils/linearRegression';

interface AIAnalysisProps {
  coinData: any;
  timeframe?: number;
  visible?: boolean; // render-only when active to speed up initial load
}

// simple in-memory cache to avoid repeated AI calls per coin/timeframe
const __analysisCache: Map<string, { at: number; data: AIAnalysis }> = new Map();

export function AIAnalysisComponent({ coinData, timeframe, visible = true }: AIAnalysisProps) {
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confidenceFactors, setConfidenceFactors] = useState<any>(null);

  // New: regression state
  const [regressionStats, setRegressionStats] = useState<{
    slope: number;
    intercept: number;
    r2: number;
    window: number;
  } | null>(null);
  const [regressionWindow, setRegressionWindow] = useState<number>(timeframe ?? 24);

  // Keep regression window in sync with unified timeframe
  useEffect(() => {
    if (typeof timeframe === 'number' && timeframe !== regressionWindow) {
      setRegressionWindow(timeframe);
    }
  }, [timeframe]);

  const generateAnalysis = async (forceRefresh = false) => {
    if (!visible) return; // avoid work when not visible
    setLoading(true);
    setError(null);

    try {
      // Calculate confidence factors for display
      const marketData: MarketData = {
        price_usd: coinData.price_usd,
        percent_change_24h: coinData.percent_change_24h,
        percent_change_7d: coinData.percent_change_7d || 0,
        volume24: coinData.volume24,
        market_cap_usd: coinData.market_cap_usd,
        rank: coinData.rank
      };

      const confidenceResult = calculateConfidence(marketData);
      setConfidenceFactors(confidenceResult);

      // Step 1: Fetch history and compute regression for context
      let localReg: { slope: number; intercept: number; r2: number; window: number } | null = null;
      try {
        const hist = await getHistoricalData(String(coinData.id ?? coinData.symbol ?? '90'), regressionWindow);
        if (hist && hist.length >= 2) {
          const n = Math.min(hist.length, Math.max(2, regressionWindow));
          const start = hist.length - n;
          const x = indexX(n);
          const y = hist.slice(start).map((p: any) => Number(p.price));
          const reg = fitLinearRegression(x, y);
          if (reg) {
            localReg = { slope: reg.slope, intercept: reg.intercept, r2: reg.r2, window: n };
            setRegressionStats(localReg);
          } else {
            setRegressionStats(null);
          }
        } else {
          setRegressionStats(null);
        }
      } catch (e) {
        console.warn('Regression computation failed:', e);
        setRegressionStats(null);
      }

      // Step 2: Use cache or call AI with context from regression + UI signals
      try {
        const key = `${coinData.id ?? coinData.symbol}:${regressionWindow}:${coinData.price_usd}`;
        const now = Date.now();
        const cached = __analysisCache.get(key);
        if (cached && now - cached.at < 5 * 60 * 1000 && !forceRefresh) {
          setAnalysis(cached.data);
          return;
        }

        const slope = localReg?.slope ?? 0;
        const r2 = localReg?.r2 ?? 0;
        const price = Number(coinData.price_usd || 0);
        const pctPerHour = price > 0 ? (slope / price) * 100 : 0;

        const ctx = {
          timeframeHours: regressionWindow,
          regression: localReg ? { slope, r2, window: localReg.window, pctPerHour } : undefined,
          display: {
            sentiment: coinloreDerived.sentiment,
            riskLevel: coinloreDerived.riskLevel,
            confidence: derived.confidence,
            timeframeLabel: derived.timeframeLabel
          }
        } as const;

        const res = await geminiAI.analyzeCryptocurrency(coinData, ctx);
        if (res && res.summary) {
          setAnalysis(res);
          __analysisCache.set(key, { at: now, data: res });
        } else {
          // Fallback to regression analysis if AI fails
          if (localReg) {
            setAnalysis(buildRegressionAnalysis(localReg, false));
          }
        }
      } catch (e) {
        console.warn('AI analysis failed:', e);
        // Check if error is due to API exhaustion/quota
        const errorMessage = e instanceof Error ? e.message : String(e);
        const isQuotaExhausted = errorMessage.toLowerCase().includes('quota') ||
                                errorMessage.toLowerCase().includes('limit') ||
                                errorMessage.toLowerCase().includes('exhausted');

        if (isQuotaExhausted) {
          console.log('Gemini API quota exhausted, using regression summary');
          // Use regression analysis when API is exhausted
          if (localReg) {
            setAnalysis(buildRegressionAnalysis(localReg, true));
          }
        } else {
          // Fallback to regression analysis for other errors
          if (localReg) {
            setAnalysis(buildRegressionAnalysis(localReg, false));
          }
        }
      }
    } catch (err) {
      setError('Failed to generate AI analysis. Please try again.');
      console.error('AI Analysis Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (coinData && visible) {
      generateAnalysis();
    }
  }, [coinData, regressionWindow, visible]);

  // Derive UI signals from regression so timeframe changes reflect immediately
  const deriveFromRegression = (priceUsd: number, slope: number, r2: number) => {
    const safePrice = priceUsd > 0 ? priceUsd : 1;
    const pctPerHour = (slope / safePrice) * 100; // % change per hour
    const absPct = Math.abs(pctPerHour);

    // Sentiment: tie to slope sign only when trend is reliable and non-trivial
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (r2 >= 0.3 && absPct >= 0.02) {
      sentiment = slope >= 0 ? 'bullish' : 'bearish';
    } else {
      sentiment = 'neutral';
    }

    // Confidence mainly tracks fit quality, blended with magnitude
    const baseConf = Math.round(Math.max(0, Math.min(100, r2 * 100)));
    const magBoost = Math.round(Math.max(0, Math.min(20, Math.min(absPct / 0.05, 1) * 20))); // up to +20
    const confidence = Math.max(0, Math.min(100, baseConf + (r2 > 0.4 ? magBoost : 0)));

    // Risk with clearer buckets and stronger dependence on velocity
    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (r2 <= 0.15 || absPct >= 0.10) {
      riskLevel = 'high';
    } else if (absPct <= 0.03 && r2 >= 0.5) {
      riskLevel = 'low';
    } else {
      // blend for the middle band
      const fitRisk = (1 - Math.max(0, Math.min(1, r2))) * 40; // weight fit less
      const velocityRisk = Math.min(absPct / 0.06, 1) * 60;    // weight velocity more
      const riskScore = Math.max(0, Math.min(100, fitRisk + velocityRisk));
      if (riskScore <= 33) riskLevel = 'low';
      else if (riskScore <= 66) riskLevel = 'medium';
      else riskLevel = 'high';
    }

    return { sentiment, confidence, riskLevel };
  };

  // Build a regression-based fallback AI analysis summary when Gemini is unavailable
  const buildRegressionAnalysis = (reg: { slope: number; r2: number; window: number }, isQuotaExhausted = false): AIAnalysis => {
    const price = Number(coinData.price_usd || 0);
    const safePrice = price > 0 ? price : 1;
    const pctPerHour = (reg.slope / safePrice) * 100;
    const absPct = Math.abs(pctPerHour);
    const dir = reg.slope >= 0 ? 'upward' : 'downward';
    const reliability = Math.round(reg.r2 * 100);
    const trendWord = reg.slope >= 0 ? 'bullish' : 'bearish';
    const { sentiment, confidence, riskLevel } = deriveFromRegression(price, reg.slope, reg.r2);
    const timeframeLabel = `${reg.window}h`;

    const summary = `Trend over the last ${timeframeLabel} is ${dir} with R² ${reliability}%, moving ~${pctPerHour.toFixed(3)}%/hour. Risk is ${riskLevel} and confidence is ${confidence} based on trend fit.`;

    const keyPoints = [
      `Slope: ${reg.slope.toFixed(6)} USD/hour (~${pctPerHour.toFixed(3)}%/h)`,
      `R²: ${reliability}% (${reliability >= 50 ? 'reliable' : 'weak'} fit)`,
      `Window: ${reg.window} points (${timeframeLabel})`,
      `Sentiment: ${trendWord} (regression-based analysis)`
    ];

    const recommendation: AIAnalysis['recommendation'] = sentiment === 'bullish' ? 'buy' : sentiment === 'bearish' ? 'sell' : 'hold';

    return {
      summary,
      sentiment,
      confidence,
      keyPoints,
      riskLevel,
      recommendation,
      timeframe: timeframeLabel,
    };
  };

  // Always derive display values for confidence from regression; timeframe label fallback
  const derived = useMemo(() => {
    if (regressionStats) {
      const d = deriveFromRegression(
        Number(coinData.price_usd || 0),
        regressionStats.slope,
        regressionStats.r2
      );
      return { confidence: d.confidence, timeframeLabel: `${regressionStats.window}h` };
    }
    return {
      confidence: 50,
      timeframeLabel: timeframe ? `${timeframe}h` : 'N/A'
    };
  }, [regressionStats?.slope, regressionStats?.r2, regressionStats?.window, coinData.price_usd, timeframe]);

  // Sentiment and Risk strictly from CoinLore data (not from Gemini nor regression)
  const coinloreDerived = useMemo(() => {
    const price = Number(coinData.price_usd ?? 0) || 0;
    const ch1 = Number(coinData.percent_change_1h ?? 0) || 0;
    const ch24 = Number(coinData.percent_change_24h ?? 0) || 0;
    const ch7 = Number(coinData.percent_change_7d ?? 0) || 0;
    const volume = Number(coinData.volume24 ?? 0) || 0;
    const mcap = Number(coinData.market_cap_usd ?? 0) || 0;

    // Choose relevant horizon based on timeframe
    const h = typeof regressionWindow === 'number' ? regressionWindow : (timeframe ?? 24);
    let horizonChange = ch24;
    if (h <= 2) horizonChange = ch1;
    else if (h <= 24) horizonChange = ch24;
    else horizonChange = ch7;

    // Threshold driven sentiment from horizon change
    const threshold = h <= 2 ? 0.2 : h <= 24 ? 1.0 : 3.0; // %
    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (horizonChange >= threshold) sentiment = 'bullish';
    else if (horizonChange <= -threshold) sentiment = 'bearish';
    else sentiment = 'neutral';

    // Risk from volatility + liquidity using only CoinLore fields
    const volatility = Math.abs(ch24) + Math.abs(ch7) / 2;
    const liqRatio = mcap > 0 ? (volume / mcap) * 100 : 0; // % of market cap traded in 24h

    let riskLevel: 'low' | 'medium' | 'high' = 'medium';
    if (volatility >= 20 || liqRatio < 0.5) riskLevel = 'high';
    else if (volatility <= 7 && liqRatio >= 2.0) riskLevel = 'low';
    else riskLevel = 'medium';

    return { sentiment, riskLevel };
  }, [coinData, regressionWindow, timeframe]);

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish':
        return <TrendingUp className="w-4 h-4 text-crypto-green" />;
      case 'bearish':
        return <TrendingDown className="w-4 h-4 text-crypto-red" />;
      default:
        return <Target className="w-4 h-4 text-crypto-blue" />;
    }
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'bullish':
        return 'bg-crypto-green/20 text-crypto-green border-crypto-green/30';
      case 'bearish':
        return 'bg-crypto-red/20 text-crypto-red border-crypto-red/30';
      default:
        return 'bg-crypto-blue/20 text-crypto-blue border-crypto-blue/30';
    }
  };

  const getRiskIcon = (risk: string) => {
    switch (risk) {
      case 'low':
        return <Shield className="w-4 h-4 text-crypto-green" />;
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-crypto-red" />;
      default:
        return <Target className="w-4 h-4 text-crypto-orange" />;
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low':
        return 'bg-crypto-green/20 text-crypto-green border-crypto-green/30';
      case 'high':
        return 'bg-crypto-red/20 text-crypto-red border-crypto-red/30';
      default:
        return 'bg-crypto-orange/20 text-crypto-orange border-crypto-orange/30';
    }
  };

  const getRecommendationColor = (recommendation: string) => {
    switch (recommendation) {
      case 'buy':
        return 'bg-crypto-green/20 text-crypto-green border-crypto-green/30';
      case 'sell':
        return 'bg-crypto-red/20 text-crypto-red border-crypto-red/30';
      default:
        return 'bg-crypto-blue/20 text-crypto-blue border-crypto-blue/30';
    }
  };

  return (
    <Card className="bg-glass-bg backdrop-blur-glass border-glass-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center space-x-2">
            <Brain className="w-5 h-5 text-crypto-green" />
            <span>AI Analysis</span>
            <Sparkles className="w-4 h-4 text-crypto-orange" />
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => generateAnalysis(true)}
              disabled={loading}
              className="hover:bg-crypto-green/10"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {loading && !analysis && (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center space-x-3">
              <Brain className="w-6 h-6 text-crypto-green animate-pulse" />
              <div className="text-muted-foreground">AI is analyzing market data...</div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-crypto-red/10 border border-crypto-red/30 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-crypto-red" />
              <span className="text-crypto-red text-sm">{error}</span>
            </div>
          </div>
        )}

        {(analysis && regressionStats) && (
          <>
            {/* Summary */}
            <div className="space-y-3">
              <h4 className="font-semibold text-foreground">AI Summary</h4>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {(analysis?.summary) || (regressionStats ? buildRegressionAnalysis(regressionStats).summary : 'Analysis not available')}
              </p>
            </div>

            {/* Key Metrics */}
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-start">
             {/* Regression summary */}
             {regressionStats && (
               <div className="space-y-1 -mt-1">
                 <div className="flex items-center space-x-2">
                   <TrendingUp className="w-4 h-4 text-crypto-blue" />
                   <span className="text-sm font-medium">Linear Trend ({regressionStats.window}h)</span>
                 </div>
                 {/* Visual meter for trend strength (bar first for alignment) */}
                 <div className="space-y-1">
                   <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                     {(() => {
                       const reliability = Math.max(0, Math.min(100, Math.round(regressionStats.r2 * 100)));
                       const width = `${reliability}%`;
                       return (
                         <div className="absolute left-0 top-0 h-full bg-crypto-green transition-all duration-500" style={{ width }} />
                       );
                     })()}
                   </div>
                   <div className="flex items-center justify-between text-xs text-muted-foreground">
                     <span className={regressionStats.slope >= 0 ? 'text-crypto-green' : 'text-crypto-red'}>
                       {regressionStats.slope >= 0 ? 'Upward' : 'Downward'}
                     </span>
                     <span>R²: <span className="font-mono">{Math.round(regressionStats.r2 * 100)}%</span></span>
                   </div>
                   <div className="text-xs text-muted-foreground">
                     Pace: <span className="font-mono">{regressionStats.slope >= 0 ? '+' : ''}{regressionStats.slope.toFixed(4)} USD/h</span>
                   </div>
                 </div>
               </div>
             )}

             {/* Sentiment from regression */}
             <div className="space-y-2">
               <div className="flex items-center space-x-2">
                 {getSentimentIcon(coinloreDerived.sentiment)}
                 <span className="text-sm font-medium">Sentiment</span>
               </div>
               <Badge className={`${getSentimentColor(coinloreDerived.sentiment)} inline-flex items-center justify-center h-6 px-3 text-xs font-medium`}>
                 {String(coinloreDerived.sentiment).toUpperCase()}
               </Badge>
             </div>

             {/* Confidence from regression */}
             <div className="space-y-2">
               <div className="flex items-center space-x-2">
                 <Target className="w-4 h-4 text-crypto-blue" />
                 <span className="text-sm font-medium">Confidence</span>
               </div>
               <div className="flex items-center space-x-2">
                 <div className="flex-1 bg-muted rounded-full h-2">
                   <div
                     className={`h-2 rounded-full transition-all duration-500 ${
                       derived.confidence >= 80 ? 'bg-crypto-green' :
                       derived.confidence >= 60 ? 'bg-crypto-blue' :
                       derived.confidence >= 40 ? 'bg-crypto-orange' : 'bg-crypto-red'
                     }`}
                     style={{ width: `${derived.confidence}%` }}
                   />
                 </div>
                 <span className="text-sm font-mono">{derived.confidence}%</span>
               </div>
             </div>

             {/* Risk from regression */}
             <div className="space-y-2">
               <div className="flex items-center space-x-2">
                 {getRiskIcon(coinloreDerived.riskLevel)}
                 <span className="text-sm font-medium">Risk Level</span>
               </div>
               <Badge className={`${getRiskColor(coinloreDerived.riskLevel)} inline-flex items-center justify-center h-6 px-3 text-xs font-medium`}>
                 {String(coinloreDerived.riskLevel).toUpperCase()}
               </Badge>
             </div>

             {/* Timeframe from regression/prop */}
             <div className="space-y-2">
               <div className="flex items-center space-x-2">
                 <Clock className="w-4 h-4 text-crypto-orange" />
                 <span className="text-sm font-medium">Timeframe</span>
               </div>
               <Badge variant="outline" className="inline-flex items-center justify-center h-6 px-3 text-xs font-medium border-crypto-orange/30 text-crypto-orange">
                 {String(derived.timeframeLabel).toUpperCase()}
               </Badge>
             </div>
           </div>

            {/* Recommendation */}
            <div className="space-y-3">
              <h4 className="font-semibold text-foreground">AI Recommendation</h4>
              <div className="flex items-center space-x-3">
                <Badge className={`${getRecommendationColor((analysis?.recommendation) || (regressionStats ? buildRegressionAnalysis(regressionStats).recommendation : 'hold'))} text-lg px-4 py-2`}>
                  {(analysis?.recommendation || (regressionStats ? buildRegressionAnalysis(regressionStats).recommendation : 'hold')).toUpperCase()}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Based on current market analysis
                </span>
              </div>
            </div>

            {/* Key Points */}
            <div className="space-y-3">
              <h4 className="font-semibold text-foreground">Key Insights</h4>
              <div className="space-y-2">
                {(analysis?.keyPoints || (regressionStats ? buildRegressionAnalysis(regressionStats).keyPoints : [])).map((point, index) => (
                  <div key={index} className="flex items-start space-x-3">
                    <div className="w-2 h-2 bg-crypto-green rounded-full mt-2 flex-shrink-0" />
                    <span className="text-sm text-muted-foreground">{point}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Disclaimer */}
            <div className="bg-muted/20 border border-border/50 rounded-lg p-3">
              <div className="flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-crypto-orange mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  This AI analysis is for informational purposes only and should not be considered as financial advice. 
                  Always conduct your own research and consult with financial professionals before making investment decisions.
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
