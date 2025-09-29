/* eslint-disable */
import { calculateConfidence, calculateChatConfidence, type MarketData } from '@/utils/confidenceCalculator';
import { analyzeMarket } from '@/utils/marketAnalysis';

/* ----------  FREE-KEY CONFIG  ---------- */
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'gemini-2.5-flash';   // free tier
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
if (!API_KEY) console.error('Gemini API key missing – check .env.local');

/* ----------  TYPES  ---------- */
export interface AIChatResponse { response: string; confidence: number; sources?: string[] }
export interface AIAnalysis {
  summary: string; sentiment: 'bullish' | 'bearish' | 'neutral'; confidence: number;
  keyPoints: string[]; riskLevel: 'low' | 'medium' | 'high'; recommendation: 'buy' | 'sell' | 'hold'; timeframe: string;
}
export interface AIPortfolioInsight {
  overallHealth: string; diversificationScore: number; riskAssessment: string;
  recommendations: string[]; rebalancingSuggestions: string[];
}

/* ----------  LOW-LEVEL REST CALL  ---------- */
async function geminiPost(body: object): Promise<string> {
  const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

/* ----------  STREAMING FOR CHAT  (free key compatible)  ---------- */
export async function chatWithAIStream(
  question: string,
  context: any,
  onDelta: (chunk: string) => void,
  shouldStop?: () => boolean
): Promise<AIChatResponse> {
  if (!API_KEY || API_KEY === 'your-gemini-api-key-here') {
    const fb = 'Gemini API key not configured.';
    onDelta(fb);
    return { response: fb, confidence: 40 };
  }

  const prompt = `You are CryptoTrend AI, an expert cryptocurrency advisor. Answer concisely (2-3 sentences max).
Question: ${question}
${context ? `Context: ${JSON.stringify(context)}` : ''}`;

  const TIMEOUT = 20_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), TIMEOUT);

  /* ----------  helper: single POST with retry ---------- */
  const postGemini = async (attempt = 1): Promise<any> => {
    const res = await fetch(`${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, topP: 0.95, topK: 40, maxOutputTokens: 2048 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });

    if (res.status === 503 && attempt === 1) {
      console.warn('Gemini 503 – retrying once');
      await new Promise(r => setTimeout(r, 1200)); // 1.2 s back-off
      return postGemini(2);
    }
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    return res.json();
  };

  try {
    const json = await postGemini();

    /* ----  block / empty text ---- */
    const promptFeedback = json.promptFeedback;
    const safety = json.candidates?.[0]?.safetyRatings;
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    if (!text) {
      const reason = promptFeedback?.blockReason || safety?.some((s: any) => s.blocked) ? 'Content filtered' : 'No response';
      throw new Error(reason); // → triggers fallback below
    }

    /* ----  simulate streaming ---- */
    const words = text.split(' ');
    const chunkSize = Math.max(1, Math.floor(words.length / 8));
    let full = '';
    for (let i = 0; i < words.length; i += chunkSize) {
      if (shouldStop?.()) break;
      const chunk = words.slice(i, i + chunkSize).join(' ') + ' ';
      full += chunk;
      onDelta(chunk);
      await new Promise(r => setTimeout(r, 50));
    }

    const questionLower = question.toLowerCase();
    let complexity: 'simple' | 'moderate' | 'complex' = 'moderate';
    if (questionLower.includes('what is') || questionLower.includes('define') || questionLower.includes('explain') || questionLower.includes('how does')) complexity = 'simple';
    if (questionLower.includes('should i') || questionLower.includes('predict') || questionLower.includes('will') || questionLower.includes('when') || questionLower.includes('technical analysis') || questionLower.includes('price target')) complexity = 'complex';
    const confidence = calculateChatConfidence(complexity, true, true);

    return { response: full.trim(), confidence };
  } catch (err: any) {
    clearTimeout(timer);
    console.error('chatWithAIStream final catch:', err);
    const fallback =
      err.message === 'Gemini 503'
        ? 'AI is overloaded – here’s a quick tip: DCA, manage risk, do your own research.'
        : 'AI service is temporarily unavailable. Tip: focus on fundamentals, manage risk, consider DCA.';
    onDelta(fallback);
    return { response: fallback, confidence: 40 };
  }
};
/* ----------  OTHER EXISTING METHODS (kept, use same geminiPost)  ---------- */
export const geminiAI = {
  async analyzeCryptocurrency(coinData: any, ctx?: any): Promise<AIAnalysis> {
    const marketData: MarketData = {
      price_usd: coinData.price_usd,
      percent_change_24h: coinData.percent_change_24h,
      percent_change_7d: coinData.percent_change_7d || 0,
      volume24: coinData.volume24,
      market_cap_usd: coinData.market_cap_usd,
      rank: coinData.rank,
    };
    const confidenceResult = calculateConfidence(marketData);
    const marketAnalysis = analyzeMarket(marketData);

    const trendContext = ctx?.regression
      ? `\nTrend Context (align your wording with this):\n- Timeframe: ${ctx?.display?.timeframeLabel || (ctx?.timeframeHours ? `${ctx.timeframeHours}h` : 'N/A')}\n- Slope: ${ctx.regression.slope.toFixed(6)} USD/hour (${ctx.regression.slope >= 0 ? 'upward' : 'downward'})\n- R^2: ${(ctx.regression.r2 * 100).toFixed(0)}% (trend reliability)\n- Pace: ${(ctx.regression.pctPerHour ?? (coinData.price_usd > 0 ? (ctx.regression.slope / coinData.price_usd) * 100 : 0)).toFixed(3)}%/hour\n- UI Sentiment: ${ctx.display?.sentiment ?? 'n/a'}\n- UI Risk: ${ctx.display?.riskLevel ?? 'n/a'}\n- UI Confidence: ${Math.round(ctx.display?.confidence ?? confidenceResult.confidence)}\n\nInstruction: The summary must be consistent with the above trend context. If slope < 0 and R^2 is non-trivial, describe a downward/bearish trend. If slope > 0 and reliable, describe an upward/bullish trend. Avoid contradicting the provided sentiment/risk.`
      : '';

    const prompt = `
Analyze this cryptocurrency and provide a market summary and key insights:
Coin: ${coinData.name} (${coinData.symbol})
Current Price: $${coinData.price_usd}
24h Change: ${coinData.percent_change_24h}%
7d Change: ${coinData.percent_change_7d || 0}%
Market Cap: $${coinData.market_cap_usd}
Volume: $${coinData.volume24}
Rank: #${coinData.rank}
${trendContext}
Provide analysis in JSON format:
{
  "summary": "2 concise sentences that align with the trend context",
  "keyPoints": ["3-4 specific insights about this cryptocurrency's current situation"]
}
Keep it factual and consistent with the provided trend context.`;

    const text = await geminiPost({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const aiAnalysis = JSON.parse(jsonMatch[0]);
      return {
        summary: aiAnalysis.summary || `${coinData.name} is currently ${marketAnalysis.sentiment} with ${marketAnalysis.recommendation} recommendation based on recent market performance.`,
        sentiment: marketAnalysis.sentiment,
        confidence: ctx?.display?.confidence ?? confidenceResult.confidence,
        keyPoints: aiAnalysis.keyPoints || [
          `${marketAnalysis.sentiment.charAt(0).toUpperCase() + marketAnalysis.sentiment.slice(1)} market sentiment`,
          `${marketAnalysis.recommendation.charAt(0).toUpperCase() + marketAnalysis.recommendation.slice(1)} recommendation for ${marketAnalysis.timeframe}`,
          `${marketAnalysis.riskLevel.charAt(0).toUpperCase() + marketAnalysis.riskLevel.slice(1)} risk level`,
        ],
        riskLevel: ctx?.display?.riskLevel ?? marketAnalysis.riskLevel,
        recommendation: marketAnalysis.recommendation,
        timeframe: ctx?.display?.timeframeLabel || marketAnalysis.timeframe,
      };
    }
    return {
      summary: `${coinData.name} shows ${marketAnalysis.sentiment} sentiment with ${marketAnalysis.recommendation} recommendation based on current market conditions and price movements.`,
      sentiment: marketAnalysis.sentiment,
      confidence: ctx?.display?.confidence ?? confidenceResult.confidence,
      keyPoints: [
        `Current market sentiment: ${marketAnalysis.sentiment}`,
        `Investment recommendation: ${marketAnalysis.recommendation}`,
        `Risk assessment: ${ctx?.display?.riskLevel ?? marketAnalysis.riskLevel}`,
        `Suggested timeframe: ${ctx?.display?.timeframeLabel || marketAnalysis.timeframe}`,
      ],
      riskLevel: ctx?.display?.riskLevel ?? marketAnalysis.riskLevel,
      recommendation: marketAnalysis.recommendation,
      timeframe: ctx?.display?.timeframeLabel || marketAnalysis.timeframe,
    };
  },

  async analyzePortfolio(holdings: any[]): Promise<AIPortfolioInsight> {
    const validHoldings = holdings.filter(h => h.amount > 0 && h.current_price > 0 && h.purchase_price > 0);
    if (validHoldings.length === 0) {
      return {
        overallHealth: 'The portfolio\'s health cannot be assessed due to missing data. No holdings or values are provided.',
        diversificationScore: 0,
        riskAssessment: 'Cannot assess risk without valid holding data.',
        recommendations: ['Add cryptocurrency holdings to your portfolio', 'Ensure all holdings have valid amounts and prices'],
        rebalancingSuggestions: ['Complete portfolio setup first'],
      };
    }

    const portfolioData = validHoldings.map(h => ({
      coin: h.coin_name,
      symbol: h.coin_symbol,
      amount: h.amount,
      value: h.amount * h.current_price,
      purchasePrice: h.purchase_price,
      currentPrice: h.current_price,
      profitLoss: (h.amount * h.current_price) - (h.amount * h.purchase_price),
      profitLossPercentage: ((h.current_price - h.purchase_price) / h.purchase_price) * 100,
    }));

    const totalValue = portfolioData.reduce((sum, h) => sum + h.value, 0);
    const totalInvested = portfolioData.reduce((sum, h) => sum + h.amount * h.purchasePrice, 0);
    const totalProfitLossPercentage = totalInvested > 0 ? ((totalValue - totalInvested) / totalInvested) * 100 : 0;
    const numHoldings = portfolioData.length;
    const largestHoldingPercentage = Math.max(...portfolioData.map(h => (h.value / totalValue) * 100));
    let diversificationScore = Math.min(numHoldings * 15, 60);
    if (largestHoldingPercentage < 50) diversificationScore += 20;
    if (largestHoldingPercentage < 30) diversificationScore += 20;
    diversificationScore = Math.min(diversificationScore, 100);

    const prompt = `
Analyze this cryptocurrency portfolio briefly:
Portfolio Holdings:
${portfolioData.map(h => `- ${h.coin}: $${h.value.toFixed(2)} (${((h.value / totalValue) * 100).toFixed(1)}%) - P&L: ${h.profitLossPercentage.toFixed(1)}%`).join('\n')}
Total Value: $${totalValue.toFixed(2)}
Total Invested: $${totalInvested.toFixed(2)}
Total P&L: ${totalProfitLossPercentage.toFixed(1)}%
Number of Holdings: ${numHoldings}
Provide concise analysis in JSON:
{
  "overallHealth": "1-2 sentence assessment based on performance and diversification",
  "diversificationScore": ${diversificationScore},
  "riskAssessment": "brief risk analysis based on holdings and performance",
  "recommendations": ["3 short actionable recommendations"],
  "rebalancingSuggestions": ["2 brief rebalancing suggestions"]
}
Keep all responses short and actionable.`;

    const text = await geminiPost({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      parsed.diversificationScore = diversificationScore;
      return parsed;
    }
    return {
      overallHealth: `Portfolio shows ${totalProfitLossPercentage >= 0 ? 'positive' : 'negative'} performance with ${numHoldings} holdings.`,
      diversificationScore: diversificationScore,
      riskAssessment: `${numHoldings < 3 ? 'High' : numHoldings < 6 ? 'Medium' : 'Low'} concentration risk detected.`,
      recommendations: ['Consider diversification', 'Monitor market trends', 'Review allocation'],
      rebalancingSuggestions: ['Rebalance quarterly', 'Consider DCA strategy'],
    };
  },

  async generateMarketPrediction(marketData: any): Promise<string> {
    const prompt = `
Based on current crypto market data, provide a brief prediction:
${JSON.stringify(marketData)}
Give a concise outlook covering:
- Market sentiment (1 sentence)
- Key trend (1 sentence)
- Main opportunity/risk (1 sentence)
Maximum 3 sentences total.`;
    try {
      return await geminiPost({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
    } catch (error) {
      console.error('Market Prediction Error:', error);
      return 'Market prediction temporarily unavailable. Please check back later for AI-powered insights.';
    }
  },
};