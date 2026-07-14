import { useEffect, useState, useCallback } from 'react'
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush, ReferenceLine,
} from 'recharts'
import { fetchKlines, type KlineData } from '@/api/gmo'

interface ChartPoint {
  time: string
  close: number
  sma20: number | null
  sma100: number | null
}

const FIFTEEN_MIN_MS = 15 * 60_000

/**
 * BID ベースで SMA を計算（ボットと同じ価格ソース）
 */
function calcSma(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += closes[j]!
      result.push(sum / period)
    }
  }
  return result
}

export default function SmaChartPage() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [latestConfirmedOpen, setLatestConfirmedOpen] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    // 今週+先週 = 14日分（SMA100 安定化 + 表示分）
    const dates: string[] = []
    const now = new Date()
    for (let i = 14; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000)
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      dates.push(`${y}${m}${dd}`)
    }

    // BID 価格で取得（ボットと同じ）
    const results = await Promise.all(
      dates.map(date => fetchKlines('USD_JPY', '15min', date))
    )
    const allKlines: KlineData[] = results.flat()

    // 形成中の足を除外（本番ボットは確定足のみで判定するため揃える）
    const nowMs = Date.now()
    const seen = new Set<string>()
    const unique = allKlines
      .filter(k => Number(k.openTime) + FIFTEEN_MIN_MS <= nowMs)
      .filter(k => { if (seen.has(k.openTime)) return false; seen.add(k.openTime); return true })
      .sort((a, b) => Number(a.openTime) - Number(b.openTime))

    const closes = unique.map(k => parseFloat(k.close))
    const sma20 = calcSma(closes, 20)
    const sma100 = calcSma(closes, 100)
    setLatestConfirmedOpen(unique.length > 0 ? Number(unique[unique.length - 1]!.openTime) : null)

    // SMA100 が安定した以降を表示
    const startIdx = Math.max(0, 99)
    const points: ChartPoint[] = unique.slice(startIdx).map((k, i) => {
      const idx = startIdx + i
      return {
        time: new Date(Number(k.openTime)).toLocaleString('ja-JP', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }),
        close: closes[idx]!,
        sma20: sma20[idx] ?? null,
        sma100: sma100[idx] ?? null,
      }
    })

    setData(points)
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    const id = setInterval(loadData, 60_000)
    return () => clearInterval(id)
  }, [loadData])

  if (loading) return <p className="text-muted-foreground text-sm">読み込み中...</p>
  if (data.length === 0) return <p className="text-muted-foreground text-sm">データなし</p>

  const latest = data[data.length - 1]
  const sma20Val = latest?.sma20?.toFixed(3) ?? '-'
  const sma100Val = latest?.sma100?.toFixed(3) ?? '-'
  const diff = latest?.sma20 != null && latest?.sma100 != null
    ? (latest.sma20 - latest.sma100)
    : null
  const isGc = diff != null && diff > 0

  const allValues = data.flatMap(d => [d.close, d.sma20, d.sma100].filter((v): v is number => v !== null))
  const minY = Math.min(...allValues) - 0.05
  const maxY = Math.max(...allValues) + 0.05

  const fmtHhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const latestConfirmedLabel = latestConfirmedOpen != null
    ? `${fmtHhmm(latestConfirmedOpen)}〜${fmtHhmm(latestConfirmedOpen + FIFTEEN_MIN_MS)}`
    : '-'
  const nextConfirmLabel = latestConfirmedOpen != null
    ? fmtHhmm(latestConfirmedOpen + FIFTEEN_MIN_MS * 2)
    : '-'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">USD/JPY 15分足 SMA(20/100)</h1>
        <div className={`text-sm font-mono px-4 py-1.5 rounded-lg border ${
          isGc
            ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-400'
            : 'border-red-400/30 bg-red-400/5 text-red-400'
        }`}>
          <div>
            SMA20: {sma20Val} / SMA100: {sma100Val}
            {diff != null && (
              <>
                <span className="ml-3 font-bold">差: {diff >= 0 ? '+' : ''}{diff.toFixed(4)}</span>
                <span className="ml-3">{isGc ? 'GC圏' : 'DC圏'}</span>
              </>
            )}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            確定足 {latestConfirmedLabel} 基準 / 次確定 {nextConfirmLabel}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        GMO klines BID 価格ベース（ボットと同一データソース）/ 形成中の足は除外しボットの判定と一致させています
      </p>

      <div className="bg-card border border-border rounded-lg p-4">
        <ResponsiveContainer width="100%" height={500}>
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="time"
              tick={{ fill: '#888', fontSize: 9 }}
              interval={Math.floor(data.length / 8)}
            />
            <YAxis
              domain={[minY, maxY]}
              tick={{ fill: '#888', fontSize: 10 }}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={65}
            />
            <Tooltip
              contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: '#888' }}
              formatter={(value, name) => {
                const labels: Record<string, string> = { close: '終値', sma20: 'SMA(20)', sma100: 'SMA(100)' }
                return [typeof value === 'number' ? value.toFixed(3) : String(value), labels[String(name)] ?? String(name)]
              }}
            />
            <Brush
              dataKey="time" height={40} stroke="#555" fill="#1a1a2e"
              travellerWidth={10} startIndex={Math.max(0, data.length - 200)}
            >
              <LineChart>
                <Line type="monotone" dataKey="close" stroke="#666" strokeWidth={1} dot={false} />
                <Line type="monotone" dataKey="sma20" stroke="#fb923c" strokeWidth={1} dot={false} />
                <Line type="monotone" dataKey="sma100" stroke="#60a5fa" strokeWidth={1} dot={false} />
              </LineChart>
            </Brush>
            <Line type="linear" dataKey="close" stroke="#555" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="sma20" stroke="#fb923c" strokeWidth={2} dot={false} connectNulls={false} />
            <Line type="monotone" dataKey="sma100" stroke="#60a5fa" strokeWidth={2} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="flex gap-4 text-xs text-muted-foreground">
        <span><span className="inline-block w-3 h-0.5 bg-orange-400 mr-1 align-middle" />SMA(20)</span>
        <span><span className="inline-block w-3 h-0.5 bg-blue-400 mr-1 align-middle" />SMA(100)</span>
        <span><span className="inline-block w-3 h-0.5 bg-gray-500 mr-1 align-middle" />終値</span>
        <span className="ml-auto">{data.length}本表示 / 1分更新</span>
      </div>
    </div>
  )
}
