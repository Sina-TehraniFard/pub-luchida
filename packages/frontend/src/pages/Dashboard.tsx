import { useCallback, useEffect, useRef, useState } from 'react'
import { http } from '@/api/http'

interface LogLine {
  timestamp?: string
  level?: string
  context?: string
  message?: string
  data?: Record<string, unknown>
  raw: string
}

function parseLine(raw: string): LogLine {
  try {
    const obj = JSON.parse(raw)
    return { ...obj, raw }
  } catch {
    return { raw }
  }
}

function toJST(ts: string): string {
  return new Date(ts).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: 'text-red-400',
  WARN: 'text-yellow-400',
  INFO: 'text-blue-300',
  DEBUG: 'text-gray-600',
}

const LEVEL_BG: Record<string, string> = {
  ERROR: 'bg-red-400/10',
  WARN: 'bg-yellow-400/5',
}

const LEVEL_LABEL: Record<string, string> = {
  ERROR: 'ERR',
  WARN: 'WRN',
  INFO: 'INF',
  DEBUG: 'DBG',
}

export default function Dashboard() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [total, setTotal] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState('')
  const [levelFilter, setLevelFilter] = useState<string>('ALL')
  const [maxLines, setMaxLines] = useState(500)
  const bottomRef = useRef<HTMLDivElement>(null)

  const fetchLogs = useCallback(async () => {
    try {
      const { data } = await http.get<{ lines: string[]; total: number }>('/logs', {
        params: { lines: maxLines },
      })
      setLines(data.lines.map(parseLine))
      setTotal(data.total)
    } catch { /* backend not running */ }
  }, [maxLines])

  useEffect(() => {
    fetchLogs()
    const id = setInterval(fetchLogs, 2000)
    return () => clearInterval(id)
  }, [fetchLogs])

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  const filtered = lines.filter(l => {
    if (levelFilter !== 'ALL' && l.level !== levelFilter) return false
    if (filter) {
      const q = filter.toLowerCase()
      return l.raw.toLowerCase().includes(q)
    }
    return true
  })

  // 最新の SMA 情報
  const latestSma = [...lines].reverse().find(l => l.data?.sma20 !== undefined && l.data?.sma100 !== undefined)
  const smaInfo = latestSma?.data ? {
    sma20: Number(latestSma.data.sma20).toFixed(3),
    sma100: Number(latestSma.data.sma100).toFixed(3),
    diff: Number(latestSma.data.diff).toFixed(4),
    cross: latestSma.data.crossType as string,
  } : null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-2xl font-bold">Luchida</h1>
        {smaInfo && (
          <div className={`text-sm font-mono px-4 py-1.5 rounded-lg border ${
            Number(smaInfo.diff) > 0
              ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-400'
              : 'border-red-400/30 bg-red-400/5 text-red-400'
          }`}>
            SMA20: {smaInfo.sma20} / SMA100: {smaInfo.sma100}
            <span className="ml-3 font-bold">
              差: {Number(smaInfo.diff) >= 0 ? '+' : ''}{smaInfo.diff}
            </span>
            <span className="ml-3">
              {Number(smaInfo.diff) > 0 ? 'GC圏' : 'DC圏'}
            </span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{total}行 / {filtered.length}表示</span>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          type="text"
          placeholder="検索..."
          className="bg-transparent border border-border rounded px-3 py-1.5 text-sm focus:border-blue-400 focus:outline-none w-48"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {['ALL', 'ERROR', 'WARN', 'INFO', 'DEBUG'].map(lv => (
          <button
            key={lv}
            onClick={() => setLevelFilter(lv)}
            className={`px-2.5 py-1 text-xs rounded ${
              levelFilter === lv
                ? 'bg-blue-400/20 text-blue-400 font-bold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {lv}
          </button>
        ))}
        <select
          className="bg-transparent border border-border rounded px-2 py-1 text-xs text-muted-foreground"
          value={maxLines}
          onChange={e => setMaxLines(Number(e.target.value))}
        >
          <option value={200}>200</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={5000}>5000</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer ml-auto">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          自動スクロール
        </label>
      </div>

      <div className="flex-1 overflow-auto bg-[#0d1117] border border-border rounded-lg font-mono text-xs leading-6">
        {filtered.map((l, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 px-3 py-px hover:bg-white/5 ${LEVEL_BG[l.level ?? ''] ?? ''}`}
          >
            {l.timestamp ? (
              <>
                <span className="text-gray-600 shrink-0">{toJST(l.timestamp)}</span>
                <span className={`shrink-0 w-7 text-center font-bold ${LEVEL_COLORS[l.level ?? ''] ?? 'text-gray-400'}`}>
                  {LEVEL_LABEL[l.level ?? ''] ?? l.level}
                </span>
                <span className="text-foreground">
                  {l.message}
                  {l.data && Object.keys(l.data).length > 0 && (
                    <span className="text-gray-500 ml-2">{JSON.stringify(l.data)}</span>
                  )}
                </span>
              </>
            ) : (
              <span className="text-gray-400">{l.raw}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
