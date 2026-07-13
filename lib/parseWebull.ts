export interface Trim {
  qty: number
  sellPrice: number
  pnl: number
  time: Date
}

export interface CompletedStockTrade {
  symbol: string
  name: string
  totalQty: number
  entryPrice: number
  totalPnl: number
  buyTime: Date
  lastSellTime: Date
  trims: Trim[]
  avgExitPrice: number
  bestTrimPnl: number
}

// A buy that hasn't been matched to a sell yet — still held. Aggregated
// across multiple lots of the same symbol into one weighted-average entry,
// the way a broker statement shows one line per position.
export interface OpenPosition {
  symbol: string
  name: string
  qty: number
  avgEntryPrice: number
  costBasis: number
  entryDate: Date
}

interface RawFill {
  symbol: string
  name: string
  side: 'Buy' | 'Sell'
  qty: number
  avgPrice: number
  filledTime: Date
}

export function parseWebull(csvText: string): { completed: CompletedStockTrade[]; open: OpenPosition[] } {
  const lines = csvText.split('\n').filter(l => l.trim())
  if (lines.length < 2) return { completed: [], open: [] }

  const filled: RawFill[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    if (cols.length < 11) continue

    const name = cols[0]
    const symbol = cols[1]
    const side = cols[2] as 'Buy' | 'Sell'
    const status = cols[3]
    const filledQty = parseInt(cols[4])
    const avgPriceRaw = cols[7].replace('@', '')
    const avgPrice = parseFloat(avgPriceRaw)
    const filledTimeStr = cols[10]

    if (status !== 'Filled') continue
    if (!filledTimeStr?.trim()) continue
    if (isNaN(avgPrice) || avgPrice <= 0) continue
    if (isNaN(filledQty) || filledQty <= 0) continue

    filled.push({ symbol, name, side, qty: filledQty, avgPrice, filledTime: new Date(filledTimeStr.trim()) })
  }

  // Sort ascending by time
  filled.sort((a, b) => a.filledTime.getTime() - b.filledTime.getTime())

  // FIFO queue per symbol — each entry tracks qty, price, time
  const openQueue: Map<string, RawFill[]> = new Map()

  // Intermediate: group trims by (symbol + buyTime + buyPrice)
  const trimGroups: Map<string, { buyFill: RawFill; trims: Trim[] }> = new Map()

  for (const trade of filled) {
    const key = trade.symbol

    if (trade.side === 'Buy') {
      if (!openQueue.has(key)) openQueue.set(key, [])
      openQueue.get(key)!.push({ ...trade })
    } else {
      const queue = openQueue.get(key) || []
      let remaining = trade.qty

      while (remaining > 0 && queue.length > 0) {
        const open = queue[0]
        const matchQty = Math.min(remaining, open.qty)
        const pnl = (trade.avgPrice - open.avgPrice) * matchQty

        // Group trims by the buy they came from
        const groupKey = `${trade.symbol}|${open.filledTime.getTime()}|${open.avgPrice}`
        if (!trimGroups.has(groupKey)) {
          trimGroups.set(groupKey, { buyFill: { ...open }, trims: [] })
        }
        trimGroups.get(groupKey)!.trims.push({
          qty: matchQty,
          sellPrice: trade.avgPrice,
          pnl,
          time: trade.filledTime,
        })

        remaining -= matchQty
        open.qty -= matchQty
        if (open.qty <= 0) queue.shift()
      }
    }
  }

  // Build final completed trades from groups
  const result: CompletedStockTrade[] = []

  for (const { buyFill, trims } of Array.from(trimGroups.values())) {
    const totalQty = trims.reduce((s, t) => s + t.qty, 0)
    const totalPnl = trims.reduce((s, t) => s + t.pnl, 0)
    const totalSellValue = trims.reduce((s, t) => s + t.sellPrice * t.qty, 0)
    const avgExitPrice = totalSellValue / totalQty
    const bestTrimPnl = Math.max(...trims.map(t => t.pnl))
    const lastSellTime = trims.reduce((latest, t) => t.time > latest ? t.time : latest, trims[0].time)

    result.push({
      symbol: buyFill.symbol,
      name: buyFill.name,
      totalQty,
      entryPrice: buyFill.avgPrice,
      totalPnl,
      buyTime: buyFill.filledTime,
      lastSellTime,
      trims,
      avgExitPrice,
      bestTrimPnl,
    })
  }

  // Sort by last sell time
  result.sort((a, b) => a.lastSellTime.getTime() - b.lastSellTime.getTime())

  // Whatever's left in each symbol's queue was never matched to a sell —
  // still held. Aggregated into one weighted-average line per symbol.
  const open: OpenPosition[] = []
  for (const [symbol, lots] of Array.from(openQueue.entries())) {
    const remaining = lots.filter(l => l.qty > 0)
    if (remaining.length === 0) continue
    const qty = remaining.reduce((s, l) => s + l.qty, 0)
    const costBasis = remaining.reduce((s, l) => s + l.qty * l.avgPrice, 0)
    const entryDate = remaining.reduce((earliest, l) => (l.filledTime < earliest ? l.filledTime : earliest), remaining[0].filledTime)
    open.push({ symbol, name: remaining[0].name, qty, avgEntryPrice: costBasis / qty, costBasis, entryDate })
  }
  open.sort((a, b) => b.costBasis - a.costBasis)

  return { completed: result, open }
}
