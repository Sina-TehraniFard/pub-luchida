import { useEffect, useRef, useState } from 'react'
import { socket } from '@/api/socket'

interface FilterStep {
  name: string
  passed: boolean
  detail: string
}

interface EntryDecision {
  time: string
  cross: 'GOLDEN_CROSS' | 'DEAD_CROSS'
  buySell: 'BUY' | 'SELL'
  sma20: string
  sma100: string
  diff: string
  bid: string
  entered: boolean
  rejectedBy: string | null
  steps: FilterStep[]
}

const fmtJst = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

export default function EntryLog() {
  const [decisions, setDecisions] = useState<EntryDecision[]>([])
  const [connected, setConnected] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    socket.connect()
    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)
    const onDecision = (d: EntryDecision) =>
      setDecisions((prev) => [...prev, d].slice(-200))

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('entry:decision', onDecision)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('entry:decision', onDecision)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [decisions])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold">エントリー判定ログ</h2>
        <span className={connected ? 'text-green-500 text-sm' : 'text-red-500 text-sm'}>
          {connected ? '● 接続中' : '○ 未接続'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        GC/DC が発生した足だけ表示。各フィルタの通過 ✓ / 却下 ✗ と、最終的にエントリーしたか弾かれたか。
      </p>

      <div className="flex-1 overflow-auto space-y-2">
        {decisions.length === 0 && (
          <div className="text-muted-foreground text-sm">
            クロス発生待ち（GC/DC が出た足のみここに流れます）
          </div>
        )}
        {decisions.map((d, i) => (
          <div
            key={i}
            className={`border rounded-md p-3 text-sm ${
              d.entered ? 'border-green-500/60' : 'border-border'
            }`}
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-xs text-muted-foreground">{fmtJst(d.time)}</span>
              <span
                className={`font-bold ${
                  d.cross === 'GOLDEN_CROSS' ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {d.cross === 'GOLDEN_CROSS' ? '★GC（BUY）' : '★DC（SELL）'}
              </span>
              <span className="font-mono text-xs">
                SMA20={d.sma20} / SMA100={d.sma100} / 差{d.diff} / bid={d.bid}
              </span>
              <span
                className={`ml-auto font-bold ${
                  d.entered ? 'text-green-500' : 'text-yellow-500'
                }`}
              >
                {d.entered ? 'エントリー' : `却下: ${d.rejectedBy}`}
              </span>
            </div>
            <div className="mt-2 flex flex-col gap-0.5">
              {d.steps.map((s, j) => (
                <div key={j} className="flex items-center gap-2 text-xs">
                  <span className={s.passed ? 'text-green-500' : 'text-red-500'}>
                    {s.passed ? '✓' : '✗'}
                  </span>
                  <span className="w-44">{s.name}</span>
                  <span className="text-muted-foreground font-mono">{s.detail}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
