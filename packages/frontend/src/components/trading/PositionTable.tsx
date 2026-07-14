import { useEffect, useState } from 'react'
import { fetchTicker } from '@/api/gmo'
import type { PositionData } from '@/types/api'

interface Props {
  positions: PositionData[]
}

interface PriceInfo {
  bid: number
  ask: number
  updatedAt: string
}

function calcPnl(position: PositionData, price: PriceInfo): { pnlYen: number; pnlPips: number } {
  const entry = parseFloat(position.entryPrice)
  const current = position.side === 'BUY' ? price.bid : price.ask
  const diff = position.side === 'BUY' ? current - entry : entry - current
  const pips = diff / 0.01
  const lot = parseInt(position.lot, 10)
  const pnlYen = diff * lot
  return { pnlYen: Math.round(pnlYen), pnlPips: Math.round(pips * 10) / 10 }
}

export default function PositionTable({ positions }: Props) {
  const [price, setPrice] = useState<PriceInfo | null>(null)

  useEffect(() => {
    if (positions.length === 0) return

    const update = async () => {
      const ticker = await fetchTicker('USD_JPY')
      if (ticker) {
        setPrice({
          bid: parseFloat(ticker.bid),
          ask: parseFloat(ticker.ask),
          updatedAt: new Date().toLocaleTimeString('ja-JP'),
        })
      }
    }

    update()
    const id = setInterval(update, 3000)
    return () => clearInterval(id)
  }, [positions.length])

  if (positions.length === 0) return null

  const totals = price
    ? positions.reduce(
        (acc, p) => {
          const { pnlYen, pnlPips } = calcPnl(p, price)
          return { yen: acc.yen + pnlYen, pips: acc.pips + pnlPips }
        },
        { yen: 0, pips: 0 },
      )
    : null

  return (
    <div className="overflow-x-auto bg-card border border-border rounded-lg">
      {price && totals && (
        <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>USD/JPY bid: <span className="font-mono text-foreground">{price.bid.toFixed(3)}</span></span>
            <span>ask: <span className="font-mono text-foreground">{price.ask.toFixed(3)}</span></span>
            <span>更新: {price.updatedAt}</span>
          </div>
          <div className={`text-right font-mono font-bold text-lg ${totals.pips >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totals.pips >= 0 ? '+' : ''}{totals.pips.toFixed(1)} pips
            <span className="text-sm ml-2">({totals.yen >= 0 ? '+' : ''}{totals.yen.toLocaleString()}円)</span>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground text-left">
            <th className="py-2 px-3 font-medium">売買</th>
            <th className="py-2 px-3 font-medium">数量</th>
            <th className="py-2 px-3 font-medium">エントリー</th>
            <th className="py-2 px-3 font-medium">現在値</th>
            <th className="py-2 px-3 font-medium">損益</th>
            <th className="py-2 px-3 font-medium">pips</th>
            <th className="py-2 px-3 font-medium">約定日時</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const pnl = price ? calcPnl(p, price) : null
            return (
              <tr key={p.id} className="border-b border-border/50">
                <td className={`py-2 px-3 font-bold ${p.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.side}
                </td>
                <td className="py-2 px-3">{p.lot}</td>
                <td className="py-2 px-3 font-mono">{p.entryPrice}</td>
                <td className="py-2 px-3 font-mono">
                  {price ? (p.side === 'BUY' ? price.bid.toFixed(3) : price.ask.toFixed(3)) : '-'}
                </td>
                <td className={`py-2 px-3 font-mono font-bold ${
                  pnl ? (pnl.pnlYen >= 0 ? 'text-emerald-400' : 'text-red-400') : ''
                }`}>
                  {pnl ? `${pnl.pnlYen >= 0 ? '+' : ''}${pnl.pnlYen.toLocaleString()}円` : '-'}
                </td>
                <td className={`py-2 px-3 font-mono ${
                  pnl ? (pnl.pnlPips >= 0 ? 'text-emerald-400' : 'text-red-400') : ''
                }`}>
                  {pnl ? `${pnl.pnlPips >= 0 ? '+' : ''}${pnl.pnlPips}` : '-'}
                </td>
                <td className="py-2 px-3 text-xs text-muted-foreground">
                  {new Date(p.openedAt).toLocaleString('ja-JP')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
