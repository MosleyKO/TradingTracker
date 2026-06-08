'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  data: { date: string; cumPnl: number }[]
}

const fmt = (n: number) =>
  n >= 0 ? `$${n.toLocaleString()}` : `-$${Math.abs(n).toLocaleString()}`

export default function EquityChart({ data }: Props) {
  const isPositive = data.length === 0 || data[data.length - 1].cumPnl >= 0

  // Deduplicate dates — keep last value per date
  const byDate = new Map<string, number>()
  for (const d of data) byDate.set(d.date, d.cumPnl)
  const deduped = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, cumPnl]) => ({ date: date.slice(5), cumPnl }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={deduped} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isPositive ? '#26c97a' : '#e05c5c'} stopOpacity={0.3} />
            <stop offset="95%" stopColor={isPositive ? '#26c97a' : '#e05c5c'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: '#7b80a0', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#7b80a0', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={55} />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid #2a2e42', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: '#7b80a0' }}
          formatter={(v: number) => [fmt(v), 'Cum. P&L']}
        />
        <Area
          type="monotone"
          dataKey="cumPnl"
          stroke={isPositive ? '#26c97a' : '#e05c5c'}
          strokeWidth={2}
          fill="url(#pnlGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
