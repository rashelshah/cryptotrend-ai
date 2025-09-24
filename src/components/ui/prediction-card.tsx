import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { fetchSnapshotsBySymbol } from '@/services/priceSnapshotsService'
import { fitLinearRegression, indexX } from '@/utils/linearRegression'

interface Props {
  symbol: string // e.g., 'BTC'
  hours?: number // history window
  horizonPoints?: number // how many steps ahead to plot/predict (e.g., next 6 points)
}

export default function PredictionCard({ symbol, hours = 24, horizonPoints = 6 }: Props) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{ time: string; price: number; pred?: number }[]>([])
  const [predictedNext, setPredictedNext] = useState<number | null>(null)
  const [r2, setR2] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    async function run() {
      setLoading(true)
      const rows = await fetchSnapshotsBySymbol(symbol, hours)

      if (!active) return

      if (!rows || rows.length < 3) {
        setData([])
        setPredictedNext(null)
        setR2(null)
        setLoading(false)
        return
      }

      // Build chart dataset
      const base = rows.map(r => ({
        time: new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        price: Number(r.price_usd)
      }))

      const x = indexX(base.length)
      const y = base.map(p => p.price)
      const lr = fitLinearRegression(x, y)

      if (!lr) {
        setData(base)
        setPredictedNext(null)
        setR2(null)
        setLoading(false)
        return
      }

      const nextX = x[x.length - 1] + 1
      const predNextValue = lr.predict(nextX)

      // Extend series with horizon predictions for visualization
      const extended = [...base]
      for (let i = 1; i <= horizonPoints; i++) {
        const xt = nextX + (i - 1) // continuous horizon
        extended.push({
          time: `+${i}`,
          price: extended[extended.length - 1].price, // keep last actual for scale; actual vs predicted is shown by separate line
        })
      }

      // Build predicted series aligned with extended X
      const xExtended = indexX(extended.length)
      const preds = xExtended.map(xt => lr.predict(xt))

      const withPred = extended.map((pt, i) => ({
        ...pt,
        pred: preds[i]
      }))

      setData(withPred)
      setPredictedNext(predNextValue)
      setR2(lr.r2)
      setLoading(false)
    }
    run()
    return () => { active = false }
  }, [symbol, hours, horizonPoints])

  const predictedText = useMemo(() => predictedNext != null ? `$${predictedNext.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}` : 'N/A', [predictedNext])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linear Regression Prediction</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-60 flex items-center justify-center">Loading prediction...</div>
        ) : data.length === 0 ? (
          <div className="text-sm text-muted-foreground">Not enough historical snapshots yet. The cron job will accumulate data.</div>
        ) : (
          <>
            <div className="mb-3 text-sm">
              <div>Predicted next price: <span className="font-semibold">{predictedText}</span>{r2 != null && (<span className="ml-2 text-muted-foreground">(R² {r2.toFixed(2)})</span>)}</div>
            </div>
            <div style={{ width: '100%', height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis tickFormatter={(v) => v >= 1 ? `$${v.toFixed(2)}` : `$${v.toFixed(6)}`} />
                  <Tooltip formatter={(v: any) => typeof v === 'number' ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : v} />
                  <Legend />
                  <Line type="monotone" dataKey="price" stroke="#1f77b4" dot={false} name="Actual" />
                  <Line type="monotone" dataKey="pred" stroke="#ff7f0e" dot={false} name="Predicted" strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}