'use client'

import { useState, useMemo } from 'react'

interface Props {
  // All trades, unfiltered — calendar manages its own month
  data: { date: string; pnl: number; trades: number }[]
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

function getBgColor(pnl: number, maxAbs: number): string {
  if (pnl === 0 || maxAbs === 0) return 'transparent'
  const intensity = Math.min(Math.abs(pnl) / maxAbs, 1)
  if (pnl > 0) {
    const g = Math.round(80 + intensity * 121)
    return `rgba(38, ${g}, 122, ${0.15 + intensity * 0.55})`
  } else {
    const r = Math.round(150 + intensity * 74)
    return `rgba(${r}, 60, 60, ${0.15 + intensity * 0.55})`
  }
}

export default function MonthlyCalendar({ data }: Props) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth()) // 0-indexed

  const pnlByDate = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number }>()
    for (const d of data) map.set(d.date, { pnl: d.pnl, trades: d.trades })
    return map
  }, [data])

  // Build calendar grid for selected month
  // We'll use Mon–Sun columns
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  // Monday=0 offset
  let startOffset = firstDay.getDay() - 1
  if (startOffset < 0) startOffset = 6 // Sunday → last column

  const cells: (number | null)[] = [
    ...Array(startOffset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (number | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // Monthly summary
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const monthEntries = data.filter(d => d.date.startsWith(monthStr))
  const monthPnl = monthEntries.reduce((s, d) => s + d.pnl, 0)
  const monthTrades = monthEntries.reduce((s, d) => s + d.trades, 0)
  const winDays = monthEntries.filter(d => d.pnl > 0).length
  const totalDays = monthEntries.length

  const maxAbs = Math.max(...monthEntries.map(d => Math.abs(d.pnl)), 1)

  const fmt = (n: number) =>
    n >= 0
      ? `+$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }
  const isNextDisabled = year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth())

  return (
    <div>
      {/* Month navigator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <button onClick={prevMonth} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 6px' }}>‹</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{MONTHS[month]} {year}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            <span style={{ color: monthPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{fmt(monthPnl)}</span>
            <span style={{ margin: '0 6px' }}>·</span>
            {monthTrades} trades
            <span style={{ margin: '0 6px' }}>·</span>
            {winDays}/{totalDays} green days
          </div>
        </div>
        <button onClick={nextMonth} disabled={isNextDisabled} style={{ background: 'none', border: 'none', color: isNextDisabled ? 'var(--border)' : 'var(--text-muted)', cursor: isNextDisabled ? 'default' : 'pointer', fontSize: 16, padding: '0 6px' }}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
        {DAYS.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {week.map((day, di) => {
              if (!day) return <div key={di} />
              const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
              const entry = pnlByDate.get(dateStr)
              const isToday = dateStr === now.toISOString().slice(0, 10)
              const isFuture = new Date(dateStr) > now
              const isWeekend = di >= 5

              return (
                <div
                  key={di}
                  style={{
                    borderRadius: 6,
                    padding: '6px 4px',
                    background: entry ? getBgColor(entry.pnl, maxAbs) : 'transparent',
                    border: isToday ? '1px solid var(--blue)' : '1px solid var(--border)',
                    opacity: isFuture || (isWeekend && !entry) ? 0.25 : 1,
                    minHeight: 54,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: isToday ? 700 : 400 }}>{day}</div>
                  {entry && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: entry.pnl >= 0 ? 'var(--green)' : 'var(--red)', lineHeight: 1.2 }}>
                        {fmt(entry.pnl)}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                        {entry.trades} trade{entry.trades !== 1 ? 's' : ''}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
