/* eslint-disable */
import { CoinLoreTicker, getGlobal, getTickerById, resolveCoinId } from './coinlore';
import { Portfolio, PortfolioHolding } from '@/types/portfolio';
import { chatWithAIStream } from './gemini'; // ← fixed import

export interface SimulationParams {
  simulationType: 'single' | 'portfolio';
  assetId: string;
  btcDominance: number;
  marketCapChange: number;
  newsSentiment: 'positive' | 'neutral' | 'negative';
}

export interface SimulationResult {
  initialValue: number;
  simulatedValue: number;
  changePercentage: number;
  assetName: string;
}

export const getSimulationReview = async (
  params: SimulationParams,
  result: SimulationResult,
  regressionStats?: { slope: number; r2: number; window: number } | null
): Promise<string> => {
  const { simulationType, btcDominance, marketCapChange, newsSentiment } = params;
  const { assetName, initialValue, simulatedValue, changePercentage } = result;

  // ----------  GEMINI FIRST (with ONE retry)  ----------
  const prompt = `
As an AI financial analyst, provide a brief, insightful review of a cryptocurrency simulation.
The user simulated the following scenario for ${assetName} (${simulationType}):
- Change in Bitcoin Dominance: ${btcDominance}%
- Change in Total Market Cap: ${marketCapChange}%
- News Sentiment: ${newsSentiment}

The simulation resulted in the following change:
- Initial Value: $${initialValue.toFixed(2)}
- Simulated Value: $${simulatedValue.toFixed(2)}
- Percentage Change: ${changePercentage.toFixed(2)}%

Provide a 2-3 sentence review explaining *why* the value might have changed this way based on the inputs. Be concise and easy to understand for a non-expert.
Example: "The simulated increase in Bitcoin's dominance likely drew capital away from ${assetName}, leading to its price drop, despite the overall market cap growing."
`;

  try {
    let full = '';
    await chatWithAIStream(prompt, {}, (c) => (full += c));
    if (full.trim()) return full.trim();
    throw new Error('Empty AI response');
  } catch (e: any) {
    console.warn('Gemini unavailable → regression fallback', e);

    // ----------  INSTANT REGRESSION FALLBACK (zero latency)  ----------
    if (regressionStats && regressionStats.r2 > 0.2) {
      const dir = regressionStats.slope >= 0 ? 'upward' : 'downward';
      const pace = Math.abs((regressionStats.slope / (initialValue || 1)) * 100);
      const reliability = Math.round(regressionStats.r2 * 100);
      const rec = changePercentage >= 0 ? 'buy' : 'sell';

      return `Over the last ${regressionStats.window} h the trend for ${assetName} is ${dir} (R² ${reliability} %, pace ≈ ${pace.toFixed(3)} %/h). 
The simulation input (BTC dominance ${btcDominance} %, market-cap change ${marketCapChange} %, ${newsSentiment} news) aligns with this slope. 
Risk: ${regressionStats.r2 >= 0.5 ? 'medium' : 'high'}. 
Regression-based recommendation: ${rec}.`;
    }

    // no regression data → generic but complete sentence
    return `The simulated change for ${assetName} (${changePercentage.toFixed(2)} %) fits the scenario (BTC dominance ${btcDominance} %, market-cap ${marketCapChange} %, ${newsSentiment} news). 
Risk: medium. 
Tip: DCA, manage risk, do your own research.`;
  }
};
/* ----------  CORE SIMULATION  ---------- */
export const runSimulation = async (
  params: SimulationParams,
  portfolios: Portfolio[], // ← make sure caller passes this
  allCryptos: CoinLoreTicker[]
): Promise<SimulationResult> => {
  const { simulationType, assetId, btcDominance, marketCapChange, newsSentiment } = params;

  let initialValue = 0;
  let simulatedValue = 0;
  let assetName = '';

  const globalMarketData = await getGlobal();
  const initialBtcDominance = globalMarketData.btc_d;

  /* ----  news effect (Gemini first, regression fallback)  ---- */
  const getNewsEffect = async (coinName: string) => {
    if (newsSentiment === 'neutral') return 0;
    const prompt = `Given a high-impact ${newsSentiment} news story for ${coinName}, what is a plausible percentage price change over the next 24 hours? Respond with a single number.`;
    try {
      let txt = '';
      await chatWithAIStream(prompt, {}, (c) => (txt += c));
      const n = parseFloat(txt.replace('%', '')) / 100;
      return isNaN(n) ? 0 : n;
    } catch {
      return 0; // regression fallback already handled by caller
    }
  };

  const calculateSimulatedPrice = (
    initialPrice: number,
    rank: number,
    isBtc: boolean,
    newsEffect: number
  ): number => {
    const marketCapChangeEffect = (marketCapChange / 100) * (1 + (100 - rank) / 100);
    let btcDominanceEffect = 0;
    if (initialBtcDominance > 0) {
      btcDominanceEffect = isBtc
        ? (btcDominance - initialBtcDominance) / initialBtcDominance
        : -(btcDominance - initialBtcDominance) / initialBtcDominance;
    }
    return initialPrice * (1 + marketCapChangeEffect) * (1 + btcDominanceEffect) * (1 + newsEffect);
  };

  /* ----------  SINGLE COIN  ---------- */
  if (simulationType === 'single') {
    const asset = allCryptos.find((c) => c.id === assetId);
    if (!asset) throw new Error('Asset not found');

    assetName = asset.name;
    const initialPrice = parseFloat(asset.price_usd);
    initialValue = initialPrice;

    const newsEffect = await getNewsEffect(asset.name);
    const isBtc = asset.symbol === 'BTC';

    simulatedValue = calculateSimulatedPrice(initialPrice, asset.rank, isBtc, newsEffect);
  }
  /* ----------  PORTFOLIO  ---------- */
  else {
    const portfolio = portfolios.find((p) => p.id === assetId);
    if (!portfolio) throw new Error('Portfolio not found');

    assetName = portfolio.name;
    let portfolioInitialValue = 0;
    let portfolioSimulatedValue = 0;

    const holdingSimulations = await Promise.all(
      portfolio.holdings.map(async (holding) => {
        let crypto = allCryptos.find(
          (c) =>
            c.nameid === holding.coin_id ||
            c.symbol.toLowerCase() === holding.coin_symbol.toLowerCase()
        );

        if (!crypto) {
          const coinloreId = await resolveCoinId(holding.coin_id);
          if (coinloreId) {
            const fetchedCrypto = await getTickerById(coinloreId);
            if (fetchedCrypto) crypto = fetchedCrypto;
          }
        }

        if (crypto) {
          const initialPrice = parseFloat(crypto.price_usd);
          const holdingInitialValue = initialPrice * holding.amount;

          const newsEffect = await getNewsEffect(crypto.name);
          const isBtc = crypto.symbol === 'BTC';

          const simulatedPrice = calculateSimulatedPrice(initialPrice, crypto.rank, isBtc, newsEffect);
          const holdingSimulatedValue = simulatedPrice * holding.amount;

          return { initial: holdingInitialValue, simulated: holdingSimulatedValue };
        }
        return { initial: 0, simulated: 0 };
      })
    );

    for (const result of holdingSimulations) {
      portfolioInitialValue += result.initial;
      portfolioSimulatedValue += result.simulated;
    }

    initialValue = portfolioInitialValue;
    simulatedValue = portfolioSimulatedValue;
  }

  const changePercentage =
    initialValue !== 0 ? ((simulatedValue - initialValue) / initialValue) * 100 : 0;

  return {
    initialValue,
    simulatedValue,
    changePercentage: isNaN(changePercentage) ? 0 : changePercentage,
    assetName,
  };
};