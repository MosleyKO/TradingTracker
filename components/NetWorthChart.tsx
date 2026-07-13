'use client'

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

interface Props {
  data: { date: string; net: number }[]
}

const fmt = (n: number) =>
  n >= 0
    ? `$${Math.round(n).toLocaleString()}`
    : `-$${Math.abs(Math.round(n)).toLocaleString()}`

export default function NetWorthChart({ data }: Props) {
  const positive = data.length === 0 || data[data.length - 1].net >= 0
  const color = positive ? '#5b8cf5' : '#e05c5c'
  const chartData = data.map(d => ({ date: d.date.slice(5), net: d.net }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="nwGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fill: '#7b80a0', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: '#7b80a0', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
          width={52}
          domain={['auto', 'auto']}
        />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid #2a2e42', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: '#7b80a0' }}
          formatter={(v: number) => [fmt(v), 'Net Worth']}
        />
        <Area
          type="monotone"
          dataKey="net"
          stroke={color}
          strokeWidth={2}
          fill="url(#nwGrad)"
          dot={{ r: 2, fill: color }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
