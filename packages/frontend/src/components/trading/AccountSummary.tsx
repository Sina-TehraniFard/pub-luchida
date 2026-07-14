import { useEffect, useState } from 'react'
import { http } from '@/api/http'

interface GmoAsset {
  equity: string
  availableAmount: string
  balance: string
  margin: string
  marginRatio: string
  positionLossGain: string
}

interface Summary {
  equity: number
  balance: number
  unrealizedPnl: number
  usedMargin: number
  marginRatio: number | null
  availableAmount: number
}

export default function AccountSummary() {
  const [summary, setSummary] = useState<Summary | null>(null)

  useEffect(() => {
    const update = async () => {
      try {
        const { data } = await http.get<GmoAsset>('/assets')
        if (!data || !data.equity) return
        const equity = Math.round(parseFloat(data.equity))
        const balance = Math.round(parseFloat(data.balance))
        const unrealizedPnl = Math.round(parseFloat(data.positionLossGain))
        const usedMargin = Math.round(parseFloat(data.margin))
        const rawRatio = parseFloat(data.marginRatio)
        const marginRatio = usedMargin > 0 ? rawRatio : null
        const availableAmount = Math.round(parseFloat(data.availableAmount))
        setSummary({ equity, balance, unrealizedPnl, usedMargin, marginRatio, availableAmount })
      } catch { /* バックエンド未起動 */ }
    }

    update()
    const id = setInterval(update, 5000)
    return () => clearInterval(id)
  }, [])

  if (!summary) return null

  const marginColor = summary.marginRatio === null
    ? 'text-muted-foreground'
    : summary.marginRatio > 300
      ? 'text-emerald-400'
      : summary.marginRatio > 150
        ? 'text-yellow-400'
        : 'text-red-400'

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <Card label="時価評価総額" value={`${summary.equity.toLocaleString()}円`} />
      <Card
        label="含み損益"
        value={`${summary.unrealizedPnl >= 0 ? '+' : ''}${summary.unrealizedPnl.toLocaleString()}円`}
        valueClass={summary.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}
      />
      <Card label="口座残高" value={`${summary.balance.toLocaleString()}円`} />
      <Card label="発注可能額" value={`${summary.availableAmount.toLocaleString()}円`} />
      <Card
        label="証拠金維持率"
        value={summary.marginRatio !== null ? `${summary.marginRatio.toFixed(0)}%` : 'ポジションなし'}
        valueClass={marginColor}
      />
    </div>
  )
}

function Card({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-lg font-bold font-mono ${valueClass ?? ''}`}>{value}</p>
    </div>
  )
}
