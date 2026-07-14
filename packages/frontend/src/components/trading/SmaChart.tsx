import { useEffect, useState, useCallback } from 'react'
import {
  ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Brush,
} from 'recharts'
import { fetchKlines, type KlineData } from '@/api/gmo'

interface ChartPoint {
  time: string
  open: number
  high: number
  low: number
  close: number
  sma20: number | null
  sma100: number | null
  // candlestick用: bodyの範囲
  bodyLow: number
  bodyHigh: number
  wickRange: [number, number]
}

const FIFTEEN_MIN_MS = 15 * 60_000

function calcSma(closes: number[], period: number): (number | null)[] {
  const result: (number | null)[] = []
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = i - period + 1; j <= i; j++) sum += closes[j]
      result.push(sum / period)
    }
  }
  return result
}

export default function SmaChart() {
  const [data, setData] = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [latestConfirmedOpen, setLatestConfirmedOpen] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    // 今日と過去32日分（約1ヶ月。3000本超 + SMA100安定化）
    const dates: string[] = []
    const now = new Date()
    for (let i = 32; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000)
      const y = d.getUTCFullYear()
      const m = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      dates.push(`${y}${m}${dd}`)
    }

    const results = await Promise.all(
      dates.map(date => fetchKlines('USD_JPY', '15min', date))
    )
    const allKlines: KlineData[] = results.flat()

    // 形成中の足を除外（本番ボットは確定足のみで判定するため揃える）
    const now = Date.now()
    const seen = new Set<string>()
    const unique = allKlines
      .filter(k => Number(k.openTime) + FIFTEEN_MIN_MS <= now)
      .filter(k => { if (seen.has(k.openTime)) return false; seen.add(k.openTime); return true })
      .sort((a, b) => Number(a.openTime) - Number(b.openTime))

    const closes = unique.map(k => parseFloat(k.close))
    const sma20 = calcSma(closes, 20)
    const sma100 = calcSma(closes, 100)
    setLatestConfirmedOpen(unique.length > 0 ? Number(unique[unique.length - 1]!.openTime) : null)

    // SMA100が安定した以降を全て表示
    const startIdx = Math.max(0, 99)
    const points: ChartPoint[] = unique.slice(startIdx).map((k, i) => {
      const idx = startIdx + i
      const o = parseFloat(k.open)
      const h = parseFloat(k.high)
      const l = parseFloat(k.low)
      const c = parseFloat(k.close)
      return {
        time: new Date(Number(k.openTime)).toLocaleTimeString('ja-JP', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
        }),
        open: o,
        high: h,
        low: l,
        close: c,
        sma20: sma20[idx],
        sma100: sma100[idx],
        bodyLow: Math.min(o, c),
        bodyHigh: Math.max(o, c),
        wickRange: [l, h],
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

  if (loading) return <p className="text-muted-foreground text-sm">チャート読み込み中...</p>
  if (data.length === 0) return <p className="text-muted-foreground text-sm">データなし</p>

  const allPrices = data.flatMap(d => [d.high, d.low])
  const smaValues = data.flatMap(d => [d.sma20, d.sma100]).filter((v): v is number => v !== null)
  const allValues = [...allPrices, ...smaValues]
  const minY = Math.min(...allValues) - 0.05
  const maxY = Math.max(...allValues) + 0.05

  // SMA20とSMA100の最新値
  const latest = data[data.length - 1]
  const sma20Val = latest?.sma20?.toFixed(3) ?? '-'
  const sma100Val = latest?.sma100?.toFixed(3) ?? '-'
  const diff = latest?.sma20 && latest?.sma100
    ? (latest.sma20 - latest.sma100).toFixed(3)
    : '-'
  const isGc = latest?.sma20 && latest?.sma100 && latest.sma20 > latest.sma100

  const fmtHhmm = (ms: number) =>
    new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  const latestConfirmedLabel = latestConfirmedOpen != null
    ? `${fmtHhmm(latestConfirmedOpen)}〜${fmtHhmm(latestConfirmedOpen + FIFTEEN_MIN_MS)}`
    : '-'
  const nextConfirmLabel = latestConfirmedOpen != null
    ? fmtHhmm(latestConfirmedOpen + FIFTEEN_MIN_MS * 2)
    : '-'

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-4 mb-1 text-xs">
        <span>
          <span className="inline-block w-3 h-0.5 bg-orange-400 mr-1 align-middle" />
          SMA(20): <span className="font-mono text-foreground">{sma20Val}</span>
        </span>
        <span>
          <span className="inline-block w-3 h-0.5 bg-blue-400 mr-1 align-middle" />
          SMA(100): <span className="font-mono text-foreground">{sma100Val}</span>
        </span>
        <span className={`font-bold ${isGc ? 'text-emerald-400' : 'text-red-400'}`}>
          {isGc ? 'GC圏' : 'DC圏'} (差: {diff})
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mb-2">
        確定足 {latestConfirmedLabel} 基準 / 次確定 {nextConfirmLabel}（形成中の足は除外、ボット判定と一致）
      </div>
      <ResponsiveContainer width="100%" height={400}>
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
              const labels: Record<string, string> = {
                close: '終値', sma20: 'SMA(20)', sma100: 'SMA(100)',
              }
              return [typeof value === 'number' ? value.toFixed(3) : String(value), labels[String(name)] ?? String(name)]
            }}
          />
          <Brush
            dataKey="time"
            height={40}
            stroke="#555"
            fill="#1a1a2e"
            travellerWidth={10}
            startIndex={Math.max(0, data.length - 200)}
          >
            <LineChart>
              <Line type="monotone" dataKey="close" stroke="#666" strokeWidth={1} dot={false} />
              <Line type="monotone" dataKey="sma20" stroke="#fb923c" strokeWidth={1} dot={false} />
              <Line type="monotone" dataKey="sma100" stroke="#60a5fa" strokeWidth={1} dot={false} />
            </LineChart>
          </Brush>
          {/* 価格ライン（close） */}
          <Line type="linear" dataKey="close" stroke="#666" strokeWidth={1} dot={false} />
          {/* SMA(20) */}
          <Line
            type="monotone" dataKey="sma20" stroke="#fb923c" strokeWidth={2}
            dot={false} connectNulls={false}
          />
          {/* SMA(100) */}
          <Line
            type="monotone" dataKey="sma100" stroke="#60a5fa" strokeWidth={2}
            dot={false} connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
