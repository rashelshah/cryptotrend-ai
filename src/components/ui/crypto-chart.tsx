import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { buildSyntheticSeries, getTickerById, resolveCoinId, getHistoricalData } from "@/lib/coinlore";
import { fitLinearRegression, indexX } from "@/utils/linearRegression";

interface ChartPoint { time: string; price: number; timestamp: number }
interface Props { coinId?: string; coinName?: string; timeframe?: number }

function CryptoChart({ coinId = "90", coinName = "Bitcoin", timeframe: timeframeProp = 24 }: Props) {
  const [data, setData] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  const [initialPrice, setInitialPrice] = useState<number>(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const navigate = useNavigate();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  // Data timeframe (hours)
  const [timeframe, setTimeframe] = useState<number>(timeframeProp);

  // Sync with prop changes from parent
  useEffect(() => {
    if (typeof timeframeProp === 'number' && timeframeProp !== timeframe) {
      setTimeframe(timeframeProp);
    }
  }, [timeframeProp, timeframe]);

  // Clear interval and set mounted flag on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    async function initializeChart() {
      if (!mountedRef.current) return;

      setLoading(true);
      setIsUpdating(false);

      // Clear any existing interval
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }

      try {
        // Resolve coin ID
        const id = await resolveCoinId(coinId);
        if (!mountedRef.current) return;

        if (!id) {
          throw new Error(`Unable to resolve coin id: ${coinId}`);
        }

        setResolvedId(id);

        // Get current ticker data
        const ticker = await getTickerById(id);
        if (!mountedRef.current) return;

        const price = Number(ticker?.price_usd ?? 0);
        setCurrentPrice(price);

        // Get historical data based on timeframe
        try {
          const historicalData = await getHistoricalData(id, timeframe);
          if (mountedRef.current && historicalData && historicalData.length > 0) {
            // Ensure data is sorted by timestamp and filter to timeframe
            const sortedData = historicalData
              .filter(point => point.timestamp && point.price)
              .sort((a, b) => a.timestamp - b.timestamp);

            // Filter to only include data within the requested timeframe
            const timeframeMs = timeframe * 60 * 60 * 1000;
            const cutoffTime = Date.now() - timeframeMs;
            const filteredData = sortedData.filter(point => point.timestamp >= cutoffTime);

            if (filteredData.length > 0) {
              setData(filteredData);
              // For 24h timeframe, try to find the price from exactly 24 hours ago
              let referencePrice = filteredData[0]?.price ?? price;
              if (timeframe === 24 && filteredData.length > 1) {
                const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
                // Find the data point closest to 24 hours ago
                const closestPoint = filteredData.reduce((closest, point) => {
                  const closestDiff = Math.abs(closest.timestamp - twentyFourHoursAgo);
                  const currentDiff = Math.abs(point.timestamp - twentyFourHoursAgo);
                  return currentDiff < closestDiff ? point : closest;
                });
                referencePrice = closestPoint?.price ?? referencePrice;
              }
              setInitialPrice(referencePrice);
              const change = referencePrice > 0 ? ((price - referencePrice) / referencePrice) * 100 : 0;
              setPriceChange(change);
            } else {
              // If no data in timeframe, use the most recent data points
              const recentData = sortedData.slice(-Math.min(timeframe, sortedData.length));
              setData(recentData);
              // For 24h timeframe, try to find the price from exactly 24 hours ago in recent data
              let referencePrice = recentData[0]?.price ?? price;
              if (timeframe === 24 && recentData.length > 1) {
                const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
                const closestPoint = recentData.reduce((closest, point) => {
                  const closestDiff = Math.abs(closest.timestamp - twentyFourHoursAgo);
                  const currentDiff = Math.abs(point.timestamp - twentyFourHoursAgo);
                  return currentDiff < closestDiff ? point : closest;
                });
                referencePrice = closestPoint?.price ?? referencePrice;
              }
              setInitialPrice(referencePrice);
              const change = referencePrice > 0 ? ((price - referencePrice) / referencePrice) * 100 : 0;
              setPriceChange(change);
            }
          } else {
            throw new Error("No historical data available");
          }
        } catch (historicalError) {
          console.warn("Historical data failed, using synthetic:", historicalError);
          // Use realistic volatility based on ticker data
          const volatility = ticker?.percent_change_24h
            ? Math.abs(Number(ticker.percent_change_24h)) / 100 * 0.3
            : 0.02;
          const series = buildSyntheticSeries(price, timeframe, volatility);

          if (mountedRef.current) {
            setData(series);
            // For synthetic data, calculate initial price to match the real change
            const realChange = Number(ticker?.percent_change_24h || 0);
            const syntheticInitial = price / (1 + realChange / 100);
            setInitialPrice(syntheticInitial);
            setPriceChange(realChange);
          }
        }
      } catch (error) {
        console.error("Error loading chart data:", error);
        if (mountedRef.current) {
          // Fallback to default data with current Bitcoin price
          const fallbackPrice = 115000;
          const series = buildSyntheticSeries(fallbackPrice, timeframe);
          setData(series);
          setCurrentPrice(series[series.length - 1].price);
          setInitialPrice(series[0].price);
          // For fallback, use 0 change since we don't have real historical data
          setPriceChange(0);
        }
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    }

    initializeChart();
  }, [coinId, timeframe]);

  // Separate effect for real-time updates
  useEffect(() => {
    if (!resolvedId || loading || !mountedRef.current) return;

    const setupInterval = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      intervalRef.current = setInterval(async () => {
        if (!mountedRef.current || isUpdating) return;

        try {
          setIsUpdating(true);
          const ticker = await getTickerById(resolvedId);

          if (!mountedRef.current) return;

          const newPrice = Number(ticker?.price_usd ?? currentPrice);
          const priceChangeThreshold = currentPrice * 0.001; // 0.1%

          if (Math.abs(newPrice - currentPrice) < priceChangeThreshold) {
            return;
          }

          setCurrentPrice(newPrice);
          const change = initialPrice > 0 ? ((newPrice - initialPrice) / initialPrice) * 100 : 0;
          setPriceChange(change);

          setData(prevData => {
            if (!mountedRef.current) return prevData;

            const newPoint: ChartPoint = {
              time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric", hour12: false }),
              price: newPrice,
              timestamp: Date.now()
            };

            const timeframeMs = timeframe * 60 * 60 * 1000;
            const cutoffTime = Date.now() - timeframeMs;
            const updatedData = [...prevData.filter(point => point.timestamp >= cutoffTime), newPoint];
            const maxPoints = Math.min(200, Math.max(50, timeframe));
            return updatedData.slice(-maxPoints);
          });
        } catch (error) {
          console.error("Error updating chart:", error);
        } finally {
          if (mountedRef.current) {
            setIsUpdating(false);
          }
        }
      }, 30000); // Update every 30 seconds
    };

    setupInterval();

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [resolvedId, loading, currentPrice, initialPrice, isUpdating, timeframe]);

  const CustomTooltip = useCallback(({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border rounded-lg p-3 shadow-lg">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-mono font-bold text-foreground">
            ${payload[0].value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
          </p>
        </div>
      );
    }
    return null;
  }, []);

  const onView = useCallback(() => {
    const id = resolvedId ?? coinId;
    navigate(`/analysis/${id}`);
  }, [resolvedId, coinId, navigate]);

  const formatYAxis = useCallback((value: number) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(0)}K`;
    } else if (value >= 1) {
      return `${value.toFixed(2)}`;
    } else {
      return `${value.toFixed(6)}`;
    }
  }, []);

  const lineColor = useMemo(() =>
    priceChange >= 0 ? 'hsl(var(--crypto-green))' : 'hsl(var(--crypto-red))',
    [priceChange]
  );

  const formattedPrice = useMemo(() =>
    currentPrice.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: currentPrice >= 1 ? 2 : 6
    }),
    [currentPrice]
  );

  const formattedPriceChange = useMemo(() =>
    `${priceChange >= 0 ? '+' : ''}${priceChange.toFixed(2)}%`,
    [priceChange]
  );

  const [showTrend, setShowTrend] = useState(true);
  const [regressionWindow, setRegressionWindow] = useState<number>(50);

  useEffect(() => {
    if (timeframe <= 24) {
      setRegressionWindow(50);
    } else if (timeframe <= 72) {
      setRegressionWindow(100);
    } else {
      setRegressionWindow(150);
    }
  }, [timeframe]);

  const regressionInfo = useMemo(() => {
    if (!data || data.length < 2) return null;
    const n = Math.min(data.length, Math.max(2, regressionWindow));
    const start = data.length - n;
    const x = indexX(n);
    const y = data.slice(start).map((d) => d.price);
    const res = fitLinearRegression(x, y);
    if (!res) return null;
    try { (window as any).__latestTrendR2 = res.r2; } catch {}
    return { res, start };
  }, [data, regressionWindow]);

  const chartData = useMemo(() => {
    if (!regressionInfo) return data;
    const { res, start } = regressionInfo;
    return data.map((d, i) => ({
      ...d,
      trend: i >= start ? res.predict(i - start) : undefined,
    }));
  }, [data, regressionInfo]);

  return (
    <Card className="bg-glass-bg backdrop-blur-glass border-glass-border">
      <CardHeader className="px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0">
          <CardTitle className="text-lg sm:text-xl lg:text-2xl font-bold">
            <div className="flex items-center space-x-2">
              {priceChange >= 0 ? (
                <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-crypto-green" />
              ) : (
                <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-crypto-red" />
              )}
              <span>{coinName}</span>
            </div>
          </CardTitle>
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline space-x-2">
              <span className="text-xl sm:text-2xl lg:text-3xl font-mono font-bold">
                ${formattedPrice}
              </span>
              <span className={`text-sm font-semibold ${priceChange >= 0 ? 'text-crypto-green' : 'text-crypto-red'}`}>
                {formattedPriceChange}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6">
        {loading ? (
          <div className="h-60 sm:h-80 flex items-center justify-center">
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              <div className="animate-pulse text-muted-foreground text-sm sm:text-base">
                Loading Chart...
              </div>
            </div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-60 sm:h-80 flex items-center justify-center">
            <div className="text-muted-foreground text-sm sm:text-base">
              No data available for this currency.
            </div>
          </div>
        ) : (
          <div className="h-60 sm:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid 
                  strokeDasharray="3 3" 
                  stroke="hsl(var(--border))" 
                  opacity={0.3} 
                />
                <XAxis 
                  dataKey="time" 
                  hide={false}
                  tickFormatter={(timeStr) => {
                    const date = new Date(timeStr);
                    if (isNaN(date.getTime())) return "";
                    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                  }}
                />
                <YAxis domain={['dataMin', 'dataMax']} tickFormatter={formatYAxis} hide={false} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke={lineColor}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                  name={coinName}
                />
                {showTrend && regressionInfo && (
                  <Line
                    type="monotone"
                    dataKey="trend"
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                    name="Trend"
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="mt-4 pt-4 border-t border-border/50">
          <button
            onClick={() => setShowTrend(!showTrend)}
            className="w-full flex items-center justify-center space-x-2 text-primary hover:text-primary-foreground hover:bg-primary transition-all duration-300 py-2 sm:py-3 px-3 sm:px-4 rounded-lg border border-primary/30 hover:border-primary shadow-lg"
          >
            <span className="text-xs sm:text-sm font-medium">
              {showTrend ? "Hide Trend" : "Show Trend"}
            </span>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// Export memoized component to prevent unnecessary re-renders
export default memo(CryptoChart);

