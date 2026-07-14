import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import type { EquityPoint } from '@/types/api'

interface Props {
  data: EquityPoint[]
}

export default function EquityChart({ data }: Props) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm italic">取引データなし</p>
  }

  const chartData = data.map(d => ({
    date: d.date,
    pnl: Number(d.cumulative_pnl),
  }))

  const minPnl = Math.min(...chartData.map(d => d.pnl))
  const maxPnl = Math.max(...chartData.map(d => d.pnl))
  const padding = Math.max(Math.abs(maxPnl - minPnl) * 0.1, 10)

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#333" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#888', fontSize: 11 }}
            tickFormatter={(v: string) => v.slice(5)}
          />
          <YAxis
            tick={{ fill: '#888', fontSize: 11 }}
            domain={[minPnl - padding, maxPnl + padding]}
            tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)}`}
          />
          <Tooltip
            contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
            labelStyle={{ color: '#888' }}
            formatter={(value) => [`${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(0)}円`, '累計損益']}
          />
          <ReferenceLine y={0} stroke="#555" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey="pnl"
            stroke="#3fb950"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
