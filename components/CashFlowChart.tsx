'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Props {
  data: { month: string; income: number; expense: number }[]
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function CashFlowChart({ data }: Props) {
  const chartData = data.map(d => ({ month: d.month.slice(2), Income: d.income, Expenses: d.expense }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <XAxis dataKey="month" tick={{ fill: '#7b80a0', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: '#7b80a0', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={v => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
          width={52}
        />
        <Tooltip
          contentStyle={{ background: '#1a1d27', border: '1px solid #2a2e42', borderRadius: 6, fontSize: 12 }}
          labelStyle={{ color: '#7b80a0' }}
          formatter={(v: number) => fmt(v)}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#7b80a0', paddingTop: 4 }} />
        <Bar dataKey="Income" fill="#26c97a" radius={[3, 3, 0, 0]} />
        <Bar dataKey="Expenses" fill="#e05c5c" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
