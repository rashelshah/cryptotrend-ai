/* eslint-disable */
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { getTickers, CoinLoreTicker } from '@/lib/coinlore';
import { usePortfolio } from '@/contexts/PortfolioContext';
import { Portfolio } from '@/types/portfolio';
import { runSimulation, getSimulationReview, SimulationResult } from '@/lib/simulator';
import { useToast } from '@/hooks/use-toast';
import { BarChart, Sliders, Newspaper, BrainCircuit, Bot, Sparkles, TrendingUp, TrendingDown, Volume2, Square } from 'lucide-react';
import { synthesizeSpeech, revokeObjectUrl } from '@/lib/elevenlabs';
import { fitLinearRegression, indexX } from '@/utils/linearRegression';
import { getHistoricalData } from '@/lib/coinlore';

const Simulator: React.FC = () => {
  const [simulationType, setSimulationType] = useState<string>('single');
  const [cryptos, setCryptos] = useState<CoinLoreTicker[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [btcDominance, setBtcDominance] = useState<number>(50);
  const [marketCapChange, setMarketCapChange] = useState<number>(0);
  const [newsSentiment, setNewsSentiment] = useState<string>('neutral');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [aiReview, setAiReview] = useState<string>('');
  const [ttsUrl, setTtsUrl] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const { portfolios } = usePortfolio();
  const { toast } = useToast();

  useEffect(() => {
    const fetchCryptos = async () => {
      const tickers = await getTickers(0, 100);
      setCryptos(tickers);
    };
    fetchCryptos();
  }, []);

  const handleStop = () => {
    try {
      if (audioEl) { audioEl.pause(); audioEl.currentTime = 0; }
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
      setIsSpeaking(false);
    } catch {}
  };

  const handleSpeak = async () => {
    if (!aiReview || aiReview.startsWith('Generating')) return;
    try {
      handleStop();
      revokeObjectUrl(ttsUrl || undefined);
      const url = await synthesizeSpeech(aiReview);
      setTtsUrl(url);
      const audio = new Audio(url);
      setAudioEl(audio);
      audio.onended = () => setIsSpeaking(false);
      await audio.play();
      setIsSpeaking(true);
    } catch {
      // fallback browser TTS
      const u = new SpeechSynthesisUtterance(aiReview);
      u.onend = () => setIsSpeaking(false);
      setIsSpeaking(true);
      window.speechSynthesis.speak(u);
    }
  };

  /*  MAIN SIMULATION + FALLBACK  */
  const handleRunSimulation = async () => {
    if (!selectedAssetId) {
      toast({ title: 'Error', description: 'Please select an asset.', variant: 'destructive' });
      return;
    }
  
    setIsLoading(true);
    setSimulationResult(null);
    setAiReview('');
    handleStop(); // kill any running TTS
  
    const params = {
      simulationType: simulationType as 'single' | 'portfolio',
      assetId: selectedAssetId,
      btcDominance,
      marketCapChange,
      newsSentiment: newsSentiment as 'positive' | 'neutral' | 'negative',
    };
  
    try {
      // 1️⃣  NUMERIC SIMULATION
      const result = await runSimulation(params, portfolios, cryptos);
      setSimulationResult(result);
  
      // 2️⃣  REGRESSION CONTEXT (always build – used by both paths)
      const hist = await getHistoricalData(selectedAssetId, 24);
      const reg = hist?.length >= 2
        ? fitLinearRegression(indexX(hist.length), hist.map((p: any) => Number(p.price)))
        : null;
  
      // 3️⃣  GEMINI FIRST – NEVER LET IT THROW TO OUTER CATCH
      try {
        setAiReview('Generating AI review...');
        const review = await getSimulationReview(params, result);
        if (!review || !review.trim()) throw new Error('Empty Gemini response'); // force fallback
        setAiReview(review);
      } catch (geminiErr: any) {
        console.warn('Gemini failed → regression fallback', geminiErr);
  
        // 4️⃣  REGRESSION FALLBACK (complete sentences)
        const fallbackText = reg
          ? `Over the last 24 h the trend is ${reg.slope >= 0 ? 'upward' : 'downward'} (R² ${Math.round(reg.r2 * 100)} %). 
  Pace ≈ ${((reg.slope / (Number(result.initialValue) || 1)) * 100).toFixed(3)} %/h. 
  Risk: ${reg.r2 >= 0.5 ? 'medium' : 'high'}. 
  Recommendation: ${reg.slope >= 0 ? 'buy' : 'sell'} based on regression fit.`
          : 'AI review unavailable – no trend data. Tip: DCA, manage risk, do your own research.';
        setAiReview(fallbackText);
      }
    } catch (error) {
      console.error('Simulation failed:', error);
      toast({ title: 'Error', description: 'Simulation failed.', variant: 'destructive' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8 animate-fade-in">
          <h1 className="text-4xl font-bold tracking-tight flex items-center">
            <BrainCircuit className="w-10 h-10 mr-3 text-crypto-green" />
            <span className="bg-gradient-primary bg-clip-text text-transparent">AI "What If" Simulator</span>
          </h1>
          <p className="text-muted-foreground mt-2">Explore potential market scenarios and test your investment theories in a risk-free environment.</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Controls Column */}
          <div className="lg:col-span-1 space-y-8">
            <Card className="bg-card/60 backdrop-blur-glass border-border/20 animate-slide-up">
              <CardHeader>
                <CardTitle className="flex items-center"><BarChart className="mr-2 text-crypto-purple" />Select Asset</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Simulation Type</Label>
                  <Select value={simulationType} onValueChange={(value) => { setSimulationType(value); setSelectedAssetId(null); }}>
                    <SelectTrigger className="bg-background/70"><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent><SelectItem value="single">Single Cryptocurrency</SelectItem><SelectItem value="portfolio">Portfolio</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{simulationType === 'single' ? 'Cryptocurrency' : 'Portfolio'}</Label>
                  <Select onValueChange={setSelectedAssetId} value={selectedAssetId || ''}>
                    <SelectTrigger className="bg-background/70"><SelectValue placeholder="Select an asset" /></SelectTrigger>
                    <SelectContent>
                      {simulationType === 'single'
                        ? cryptos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.symbol})</SelectItem>)
                        : portfolios.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/60 backdrop-blur-glass border-border/20 animate-slide-up" style={{ animationDelay: '0.2s' }}>
              <CardHeader>
                <CardTitle className="flex items-center"><Sliders className="mr-2 text-crypto-orange" />Market Conditions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-4">
                <div className="space-y-3">
                  <Label className="flex justify-between"><span>Bitcoin Dominance</span><span className="font-bold text-crypto-orange">{btcDominance}%</span></Label>
                  <Slider value={[btcDominance]} onValueChange={(v) => setBtcDominance(v[0])} max={100} step={1} />
                </div>
                <div className="space-y-3">
                  <Label className="flex justify-between"><span>Market Cap Change</span><span className={`font-bold ${marketCapChange >= 0 ? 'text-crypto-green' : 'text-crypto-red'}`}>{marketCapChange}%</span></Label>
                  <Slider value={[marketCapChange]} onValueChange={(v) => setMarketCapChange(v[0])} min={-50} max={50} step={1} />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/60 backdrop-blur-glass border-border/20 animate-slide-up" style={{ animationDelay: '0.4s' }}>
              <CardHeader>
                <CardTitle className="flex items-center"><Newspaper className="mr-2 text-crypto-blue" />AI-Generated News</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Simulated News Sentiment</Label>
                  <Select value={newsSentiment} onValueChange={setNewsSentiment}>
                    <SelectTrigger className="bg-background/70"><SelectValue placeholder="Select sentiment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="positive">High-Impact Positive</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                      <SelectItem value="negative">High-Impact Negative</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Button onClick={handleRunSimulation} disabled={isLoading || cryptos.length === 0} className="w-full bg-crypto-blue hover:bg-crypto-blue/90 text-lg font-bold py-6 animate-slide-up" style={{ animationDelay: '0.6s' }}>
              {isLoading ? 'Simulating...' : <><Sparkles className="mr-2" />Run Simulation</>}
            </Button>
          </div>

          {/* Results Column */}
          <div className="lg:col-span-2 space-y-8">
            <Card className="bg-card/60 backdrop-blur-glass border-border/20 min-h-[200px] flex items-center justify-center animate-scale-in">
              <CardContent className="pt-6 w-full">
                {isLoading && !simulationResult ? (
                  <div className="text-center text-muted-foreground"><Bot className="w-12 h-12 mx-auto mb-4 animate-pulse-glow" />Running simulation...</div>
                ) : simulationResult ? (
                  <div className="text-center">
                    <h3 className="text-2xl font-bold mb-2">{simulationResult.assetName}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center my-6">
                      <div className="bg-background/50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Initial Value</p>
                        <p className="text-3xl font-bold">${simulationResult.initialValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                      <div className={`p-4 rounded-lg ${simulationResult.changePercentage >= 0 ? 'bg-crypto-green/10' : 'bg-crypto-red/10'}`}>
                        <p className="text-sm text-muted-foreground">Change</p>
                        <p className={`text-3xl font-bold flex items-center justify-center ${simulationResult.changePercentage >= 0 ? 'text-crypto-green' : 'text-crypto-red'}`}>
                          {simulationResult.changePercentage >= 0 ? <TrendingUp className="mr-2"/> : <TrendingDown className="mr-2"/>}
                          {simulationResult.changePercentage.toFixed(2)}%
                        </p>
                      </div>
                      <div className="bg-background/50 p-4 rounded-lg">
                        <p className="text-sm text-muted-foreground">Simulated Value</p>
                        <p className="text-3xl font-bold">${simulationResult.simulatedValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground">
                    <BrainCircuit className="w-12 h-12 mx-auto mb-4" />
                    Your simulation results will appear here.
                  </div>
                )}
              </CardContent>
            </Card>

            {(aiReview || (isLoading && simulationResult)) && (
              <Card className="bg-card/60 backdrop-blur-glass border-border/20 animate-fade-in">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center"><Bot className="mr-2 text-crypto-purple" />AI Review</span>
                    <div className="flex items-center gap-2">
                      {!isSpeaking ? (
                        <Button variant="outline" size="sm" onClick={handleSpeak} disabled={!aiReview || aiReview.startsWith('Generating')}>
                          <Volume2 className="w-4 h-4 mr-1" /> Play
                        </Button>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={handleStop}>
                          <Square className="w-4 h-4 mr-1" /> Stop
                        </Button>
                      )}
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground whitespace-pre-wrap">{aiReview}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Simulator;