export interface Trim {
  qty: number
  price: number
  pnl: number
  time: Date
}

export interface Trade {
  symbol: string
  pnl: number
  closeTime: Date
  openTime?: Date
  entryPrice?: number
  avgExitPrice?: number
  bestTrimPnl?: number
  totalQty?: number
  trims?: Trim[]
  account?: string
}

export interface Stats {
  netPnl: number
  tradeCount: number
  winRate: number
  profitFactor: number
  dayWinRate: number
  avgWin: number
  avgLoss: number
  maxDrawdown: number
  recoveryFactor: number
  consistency: number
  score: number
  equityCurve: { date: string; cumPnl: number }[]
  calendarData: { date: string; pnl: number }[]
  trades: Trade[]
}

export function calcStats(trades: Trade[]): Stats {
  if (trades.length === 0) {
    return {
      netPnl: 0, tradeCount: 0, winRate: 0, profitFactor: 0,
      dayWinRate: 0, avgWin: 0, avgLoss: 0, maxDrawdown: 0,
      recoveryFactor: 0, consistency: 0, score: 0,
      equityCurve: [], calendarData: [], trades: [],
    }
  }

  const sorted = [...trades].sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime())

  const winners = sorted.filter(t => t.pnl > 0)
  const losers = sorted.filter(t => t.pnl < 0)

  const netPnl = sorted.reduce((s, t) => s + t.pnl, 0)
  const winRate = winners.length / sorted.length
  const grossWin = winners.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0))
  const profitFactor = grossLoss === 0 ? grossWin : grossWin / grossLoss
  const avgWin = winners.length ? grossWin / winners.length : 0
  const avgLoss = losers.length ? grossLoss / losers.length : 0

  // Day win rate
  const dayMap: Map<string, number> = new Map()
  for (const t of sorted) {
    const day = t.closeTime.toISOString().slice(0, 10)
    dayMap.set(day, (dayMap.get(day) || 0) + t.pnl)
  }
  const days = Array.from(dayMap.values())
  const winDays = days.filter(d => d > 0).length
  const dayWinRate = days.length ? winDays / days.length : 0

  // Equity curve
  let cumPnl = 0
  const equityCurve = sorted.map(t => {
    cumPnl += t.pnl
    return { date: t.closeTime.toISOString().slice(0, 10), cumPnl: parseFloat(cumPnl.toFixed(2)) }
  })

  const calendarData = Array.from(dayMap.entries()).map(([date, pnl]) => ({ date, pnl }))

  // Max drawdown
  let peak = 0, maxDrawdown = 0, running = 0
  for (const t of sorted) {
    running += t.pnl
    if (running > peak) peak = running
    const dd = peak - running
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  const recoveryFactor = maxDrawdown === 0 ? 10 : Math.min(netPnl / maxDrawdown, 10)
  const consistency = dayWinRate

  const score = Math.min(100, Math.round(
    winRate * 25 +
    Math.min(profitFactor / 3, 1) * 25 +
    (avgLoss === 0 ? 25 : Math.min(avgWin / avgLoss / 3, 1) * 25) +
    consistency * 15 +
    Math.min(recoveryFactor / 10, 1) * 10
  ))

  return {
    netPnl, tradeCount: sorted.length, winRate, profitFactor,
    dayWinRate, avgWin, avgLoss, maxDrawdown, recoveryFactor,
    consistency, score, equityCurve, calendarData, trades: sorted,
  }
}
