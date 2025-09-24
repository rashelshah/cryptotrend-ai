// Example Supabase Edge Function (Deno) to capture CoinLore prices periodically
// Deploy in your Supabase project under supabase/functions/price-snapshots/index.ts
// Then schedule with Supabase cron: every 5-10 minutes.

/*
Instructions:
1) Create function in your Supabase project repo (not this frontend):
   supabase/functions/price-snapshots/index.ts

2) Paste this code (adapt imports to Deno environment).

3) Deploy:
   supabase functions deploy price-snapshots --no-verify-jwt --project-ref <YOUR_PROJECT_REF>

4) Schedule (every 10 minutes):
   supabase cron create price-snapshots --schedule "*/10 * * * *" --endpoint \
    https://mznoxwugmbsfrprbfbda.supabase.co.functions.supabase.co/price-snapshots
*/

// Deno-style code (for reference). Not executed in this React app.
// deno-lint-ignore-file no-explicit-any
export const edgeFunctionExample = `
// supabase/functions/price-snapshots/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// You will set these in your Supabase project (Function secrets)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

async function fetchCoinLoreTickers(start = 0, limit = 100) {
  const url = `https://api.coinlore.net/api/tickers/?start=${start}&limit=${limit}`
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(
    `CoinLore HTTP ${res.status} ${res.statusText}`
  )
  const json = await res.json()
  return Array.isArray(json?.data) ? json.data : []
}

Deno.serve(async (req) => {
  try {
    // Fetch top 100 coins (adjust as needed)
    const data = await fetchCoinLoreTickers(0, 100)

    if (!Array.isArray(data) || data.length === 0) {
      return new Response(JSON.stringify({ inserted: 0, reason: 'no data' }), { status: 200 })
    }

    // Normalize to snapshot rows
    const rows = data.map((c: any) => ({
      symbol: String(c.symbol || '').toUpperCase(),
      coinlore_id: String(c.id || ''),
      name: c.name || null,
      nameid: c.nameid || null,
      price_usd: Number(c.price_usd || 0),
      market_cap_usd: c.market_cap_usd != null ? Number(c.market_cap_usd) : null,
      volume24: c.volume24 != null ? Number(c.volume24) : null,
      rank: c.rank != null ? Number(c.rank) : null,
      source: 'coinlore'
    }))

    // Insert in batches to avoid payload limits
    const chunkSize = 200
    let inserted = 0
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      const { error, count } = await supabase
        .from('price_snapshots')
        .insert(chunk, { count: 'exact' })

      if (error) {
        console.error('Insert error:', error)
        throw error
      }
      inserted += (count || chunk.length)
    }

    return new Response(JSON.stringify({ inserted }), { status: 200 })
  } catch (e) {
    console.error('Edge function error:', e)
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500 })
  }
})
`