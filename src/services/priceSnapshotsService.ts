import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export type PriceSnapshot = {
  id: string
  created_at: string
  symbol: string
  coinlore_id: string | null
  name: string | null
  nameid: string | null
  price_usd: number
  market_cap_usd: number | null
  volume24: number | null
  rank: number | null
  source: string
}

/** Fetch historical snapshots for a symbol within last N hours (default 24h). */
export async function fetchSnapshotsBySymbol(symbol: string, hours = 24): Promise<PriceSnapshot[]> {
  if (!isSupabaseConfigured()) return []
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
    const { data, error } = await supabase
      .from('price_snapshots')
      .select('*')
      .eq('symbol', symbol.toUpperCase())
      .gte('created_at', since)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('fetchSnapshotsBySymbol error:', error)
      return []
    }

    // Ensure numeric types
    return (data || []).map((d: any) => ({
      ...d,
      price_usd: Number(d.price_usd),
      market_cap_usd: d.market_cap_usd != null ? Number(d.market_cap_usd) : null,
      volume24: d.volume24 != null ? Number(d.volume24) : null,
    }))
  } catch (e) {
    console.error('fetchSnapshotsBySymbol exception:', e)
    return []
  }
}

/** Optional: Insert snapshot (mainly for local testing; production inserts are done by Edge Function). */
export async function insertSnapshot(row: Omit<PriceSnapshot, 'id' | 'created_at' | 'source'> & { source?: string }) {
  if (!isSupabaseConfigured()) return { data: null, error: { message: 'Supabase not configured' } }
  const payload = { ...row, symbol: row.symbol.toUpperCase(), source: row.source || 'client' }
  const { data, error } = await supabase.from('price_snapshots').insert(payload).select('*')
  return { data, error }
}