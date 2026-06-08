'use client'

import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import { Stats } from '@/lib/stats'

interface Props {
  stats: Stats
}

export default function RadarScore({ stats }: Props) {
  const data = [
    { subject: 'Win %', value: Math.round(stats.winRate * 100) },
    { subject: 'Profit Factor', value: Math.min(Math.round((stats.profitFactor / 3) * 100), 100) },
    { subject: 'Avg Win/Loss', value: stats.avgLoss === 0 ? 100 : Math.min(Math.round((stats.avgWin / stats.avgLoss / 3) * 100), 100) },
    { subject: 'Max Drawdown', value: stats.maxDrawdown === 0 ? 100 : Math.min(Math.round((stats.netPnl / stats.maxDrawdown / 3) * 100), 100) },
    { subject: 'Consistency', value: Math.round(stats.consistency * 100) },
    { subject: 'Recovery', value: Math.min(Math.round((stats.recoveryFactor / 10) * 100), 100) },
  ]

  return (
    <div className="panel">
      <div className="panel-title">Score</div>
      <div className="score-display">
        <div className="score-number">{stats.score}</div>
        <div className="score-label">out of 100</div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={data} margin={{ top: 0, right: 20, left: 20, bottom: 0 }}>
          <PolarGrid stroke="#2a2e42" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#7b80a0', fontSize: 10 }} />
          <Radar dataKey="value" stroke="#5b8cf5" fill="#5b8cf5" fillOpacity={0.25} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
