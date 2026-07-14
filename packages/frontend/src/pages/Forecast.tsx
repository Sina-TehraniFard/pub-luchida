import { useState } from 'react'

const MONTHS = 60

export default function Forecast() {
  const [initialCapital] = useState(70_000)
  const [annualRate, setAnnualRate] = useState<string>('')
  const [monthlyReturnRates, setMonthlyReturnRates] = useState<number[]>(() =>
    Array.from({ length: MONTHS }, () => 0),
  )
  const [deposits, setDeposits] = useState<number[]>(() =>
    Array.from({ length: MONTHS }, () => 50_000),
  )

  const useAnnual = annualRate !== '' && Number(annualRate) !== 0
  // 年利 → 月利: (1 + r)^(1/12) - 1
  const annualMonthlyRate = useAnnual
    ? (Math.pow(1 + Number(annualRate) / 100, 1 / 12) - 1) * 100
    : 0

  const updateDeposit = (month: number, value: number) => {
    setDeposits(prev => {
      const next = [...prev]
      next[month] = value
      return next
    })
  }

  const updateRate = (month: number, value: number) => {
    setMonthlyReturnRates(prev => {
      const next = [...prev]
      next[month] = value
      return next
    })
  }

  const fillRateFrom = (month: number) => {
    setMonthlyReturnRates(prev => {
      const next = [...prev]
      const val = next[month]
      for (let i = month + 1; i < MONTHS; i++) next[i] = val
      return next
    })
  }

  // 「ここから先を同じ値に」
  const fillFrom = (month: number) => {
    setDeposits(prev => {
      const next = [...prev]
      const val = next[month]
      for (let i = month + 1; i < MONTHS; i++) next[i] = val
      return next
    })
  }

  const START_YEAR = 2026
  const START_MONTH = 4 // 4月

  const formatYm = (idx: number) => {
    const totalMonth = START_MONTH - 1 + idx
    const y = START_YEAR + Math.floor(totalMonth / 12)
    const m = (totalMonth % 12) + 1
    return `${y}/${String(m).padStart(2, '0')}`
  }

  const rows: { idx: number; label: string; deposit: number; rate: number; cumDeposit: number; profit: number; total: number; isYearEnd: boolean }[] = []
  let capital = initialCapital
  let cumDeposit = initialCapital
  for (let m = 0; m < MONTHS; m++) {
    if (m > 0) {
      capital += deposits[m]
      cumDeposit += deposits[m]
    }
    const effectiveRate = useAnnual ? annualMonthlyRate : monthlyReturnRates[m]
    const profit = Math.round(capital * (effectiveRate / 100))
    capital += profit
    const totalMonth = START_MONTH - 1 + m
    const calMonth = (totalMonth % 12) + 1
    rows.push({ idx: m, label: formatYm(m), deposit: deposits[m], rate: effectiveRate, cumDeposit, profit, total: capital, isYearEnd: calMonth === 12 })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">予想収益シミュレーション</h1>
      <div className="text-sm text-muted-foreground space-y-3">
        <p>初期資金: {initialCapital.toLocaleString()}円</p>
        <div className="flex items-center gap-3">
          <label className="text-foreground font-medium">年利:</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              className="w-24 bg-transparent border border-border rounded px-2 py-1 text-right font-mono focus:border-blue-400 focus:outline-none"
              value={annualRate}
              onChange={e => setAnnualRate(e.target.value)}
              placeholder="—"
              step={1}
            />
            <span className="text-xs">%</span>
          </div>
          {useAnnual && (
            <span className="text-xs text-blue-400">
              → 月利 {annualMonthlyRate.toFixed(2)}%（個別月利は無視）
            </span>
          )}
          {!useAnnual && (
            <span className="text-xs">未入力時は個別月利を使用</span>
          )}
        </div>
        <p className="text-xs">数字をクリックで編集。「↓」で以降の月に同じ値をコピー。</p>
      </div>

      <div className="overflow-x-auto bg-card border border-border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-left">
              <th className="py-2 px-3 font-medium">月</th>
              <th className="py-2 px-3 font-medium text-right">積立金</th>
              <th className="py-2 px-3 font-medium w-8"></th>
              <th className="py-2 px-3 font-medium text-right">月利</th>
              <th className="py-2 px-3 font-medium w-8"></th>
              <th className="py-2 px-3 font-medium text-right">累計入金</th>
              <th className="py-2 px-3 font-medium text-right">月間収益</th>
              <th className="py-2 px-3 font-medium text-right">運用資金</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              return (
                <tr
                  key={r.idx}
                  className={`border-b border-border/50 ${r.isYearEnd ? 'bg-accent/30 font-bold' : ''}`}
                >
                  <td className="py-1.5 px-3">
                    {r.label}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {r.idx === 0 ? (
                      <span className="font-mono text-muted-foreground">—</span>
                    ) : (
                      <input
                        type="number"
                        className="w-24 bg-transparent border border-border/50 rounded px-2 py-0.5 text-right font-mono focus:border-blue-400 focus:outline-none"
                        value={r.deposit}
                        onChange={e => updateDeposit(r.idx, Number(e.target.value) || 0)}
                        step={10000}
                      />
                    )}
                  </td>
                  <td className="py-1 px-1">
                    {r.idx > 0 && (
                      <button
                        onClick={() => fillFrom(r.idx)}
                        className="text-muted-foreground hover:text-foreground text-xs"
                        title="この金額を以降の月にコピー"
                      >
                        ↓
                      </button>
                    )}
                  </td>
                  <td className={`py-1 px-3 text-right ${useAnnual ? 'opacity-30' : ''}`}>
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        className="w-20 bg-transparent border border-border/50 rounded px-2 py-0.5 text-right font-mono focus:border-blue-400 focus:outline-none disabled:cursor-not-allowed"
                        value={useAnnual ? Number(r.rate.toFixed(2)) : monthlyReturnRates[r.idx]}
                        onChange={e => updateRate(r.idx, Number(e.target.value) || 0)}
                        step={0.1}
                        disabled={useAnnual}
                      />
                      <span className="text-muted-foreground text-xs">%</span>
                    </div>
                  </td>
                  <td className={`py-1 px-1 ${useAnnual ? 'opacity-30' : ''}`}>
                    <button
                      onClick={() => fillRateFrom(r.idx)}
                      className="text-muted-foreground hover:text-foreground text-xs disabled:cursor-not-allowed"
                      title="この月利を以降の月にコピー"
                      disabled={useAnnual}
                    >
                      ↓
                    </button>
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono">
                    {r.cumDeposit.toLocaleString()}円
                  </td>
                  <td className={`py-1.5 px-3 text-right font-mono ${r.profit > 0 ? 'text-emerald-400' : ''}`}>
                    {r.profit > 0 ? '+' : ''}{r.profit.toLocaleString()}円
                  </td>
                  <td className="py-1.5 px-3 text-right font-mono font-bold">
                    {r.total.toLocaleString()}円
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
