'use client'

interface Props {
  data: { date: string; pnl: number }[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getColor(pnl: number): string {
  if (pnl === 0) return '#22263a'
  if (pnl > 0) {
    if (pnl > 500) return '#26c97a'
    if (pnl > 200) return '#1a9e5e'
    return '#0f6640'
  } else {
    if (pnl < -500) return '#e05c5c'
    if (pnl < -200) return '#b04545'
    return '#6b2a2a'
  }
}

export default function CalendarHeatmap({ data }: Props) {
  if (data.length === 0) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No data</div>

  const pnlByDate = new Map(data.map(d => [d.date, d.pnl]))

  // Build a 12-week calendar ending today
  const today = new Date()
  const weeks: Date[][] = []
  const start = new Date(today)
  start.setDate(start.getDate() - 11 * 7 - start.getDay())

  for (let w = 0; w < 12; w++) {
    const week: Date[] = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(start)
      day.setDate(start.getDate() + w * 7 + d)
      week.push(day)
    }
    weeks.push(week)
  }

  const fmt = (n: number) =>
    n >= 0 ? `+$${n.toFixed(0)}` : `-$${Math.abs(n).toFixed(0)}`

  return (
    <div>
      <div style={{ display: 'flex', gap: 3 }}>
        {/* Day labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginRight: 4 }}>
          {DAYS.map(d => (
            <div key={d} style={{ height: 14, fontSize: 9, color: 'var(--text-muted)', lineHeight: '14px' }}>
              {d[0]}
            </div>
          ))}
        </div>
        {/* Weeks */}
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {week.map((day, di) => {
              const dateStr = day.toISOString().slice(0, 10)
              const pnl = pnlByDate.get(dateStr)
              const isFuture = day > today
              const color = isFuture ? 'transparent' : pnl !== undefined ? getColor(pnl) : '#1a1d27'
              const title = pnl !== undefined ? `${dateStr}: ${fmt(pnl)}` : dateStr
              return (
                <div
                  key={di}
                  title={title}
                  style={{
                    width: 14, height: 14, borderRadius: 2,
                    background: color,
                    border: pnl !== undefined ? 'none' : isFuture ? 'none' : '1px solid #2a2e42',
                    cursor: pnl !== undefined ? 'pointer' : 'default',
                  }}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 10, color: 'var(--text-muted)' }}>
        <span>Less</span>
        {['#6b2a2a', '#b04545', '#e05c5c', '#1a1d27', '#0f6640', '#1a9e5e', '#26c97a'].map(c => (
          <div key={c} style={{ width: 10, height: 10, borderRadius: 2, background: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
