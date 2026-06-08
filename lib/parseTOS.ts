export interface TOSTrim {
  qty: number
  closePrice: number
  pnl: number
  time: Date
}

export interface CompletedTrade {
  symbol: string
  strike: number
  exp: string
  type: 'CALL' | 'PUT'
  totalQty: number
  openPrice: number
  avgClosePrice: number
  bestTrimPnl: number
  openTime: Date
  closeTime: Date
  pnl: number
  trims: TOSTrim[]
}

interface RawTrade {
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  posEffect: 'TO OPEN' | 'TO CLOSE'
  exp: string
  strike: number
  type: 'CALL' | 'PUT'
  price: number
  execTime: Date
}

export function parseTOS(csvText: string): CompletedTrade[] {
  const lines = csvText.split('\n')

  const startIdx = lines.findIndex(l => l.includes('Account Trade History'))
  if (startIdx === -1) return []

  const rawTrades: RawTrade[] = []

  for (let i = startIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.startsWith('Account') || line.startsWith('Options') || line.startsWith('Profits')) break

    const cols = line.split(',').map(c => c.trim().replace(/^=?"?|"?$/g, ''))
    if (cols.length < 11) continue

    const execTimeStr = cols[1]
    const side = cols[3] as 'BUY' | 'SELL'
    const qtyRaw = cols[4]
    const posEffect = cols[5] as 'TO OPEN' | 'TO CLOSE'
    const symbol = cols[6]
    const exp = cols[7]
    const strike = parseFloat(cols[8])
    const optType = cols[9] as 'CALL' | 'PUT'
    const price = parseFloat(cols[10])

    if (!execTimeStr || !symbol || !side || isNaN(price)) continue
    if (posEffect !== 'TO OPEN' && posEffect !== 'TO CLOSE') continue

    const qty = Math.abs(parseInt(qtyRaw.replace(/[^0-9]/g, '')))
    rawTrades.push({ symbol, side, qty, posEffect, exp, strike, type: optType, price, execTime: new Date(execTimeStr) })
  }

  rawTrades.sort((a, b) => a.execTime.getTime() - b.execTime.getTime())

  // FIFO open queue per contract key
  const openQueue: Map<string, RawTrade[]> = new Map()

  // Group trims by open event: openKey → { openTrade, trims[] }
  const tradeMap: Map<string, { open: RawTrade; trims: TOSTrim[] }> = new Map()

  for (const trade of rawTrades) {
    const contractKey = `${trade.symbol}|${trade.strike}|${trade.exp}|${trade.type}`

    if (trade.posEffect === 'TO OPEN') {
      if (!openQueue.has(contractKey)) openQueue.set(contractKey, [])
      for (let i = 0; i < trade.qty; i++) {
        openQueue.get(contractKey)!.push({ ...trade, qty: 1 })
      }
    } else {
      const queue = openQueue.get(contractKey) || []
      let remaining = trade.qty

      // Accumulate matched contracts grouped by their open event
      const matchGroups: Map<string, { open: RawTrade; qty: number }> = new Map()

      while (remaining > 0 && queue.length > 0) {
        const open = queue.shift()!
        const groupKey = `${contractKey}|${open.execTime.getTime()}|${open.price}`
        if (!matchGroups.has(groupKey)) matchGroups.set(groupKey, { open, qty: 0 })
        matchGroups.get(groupKey)!.qty++
        remaining--
      }

      for (const [groupKey, { open, qty }] of Array.from(matchGroups.entries())) {
        const pnl = (trade.price - open.price) * qty * 100
        const openKey = `${contractKey}|${open.execTime.getTime()}|${open.price}`

        if (!tradeMap.has(openKey)) {
          tradeMap.set(openKey, { open, trims: [] })
        }
        tradeMap.get(openKey)!.trims.push({
          qty,
          closePrice: trade.price,
          pnl,
          time: trade.execTime,
        })
      }
    }
  }

  // Build final completed trades
  const result: CompletedTrade[] = []

  for (const { open, trims } of Array.from(tradeMap.values())) {
    const totalQty = trims.reduce((s, t) => s + t.qty, 0)
    const totalPnl = trims.reduce((s, t) => s + t.pnl, 0)
    const totalCloseValue = trims.reduce((s, t) => s + t.closePrice * t.qty, 0)
    const avgClosePrice = totalCloseValue / totalQty
    const bestTrimPnl = Math.max(...trims.map(t => t.pnl))
    const lastCloseTime = trims.reduce((latest, t) => t.time > latest ? t.time : latest, trims[0].time)

    result.push({
      symbol: open.symbol,
      strike: open.strike,
      exp: open.exp,
      type: open.type,
      totalQty,
      openPrice: open.price,
      avgClosePrice,
      bestTrimPnl,
      openTime: open.execTime,
      closeTime: lastCloseTime,
      pnl: totalPnl,
      trims,
    })
  }

  result.sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime())
  return result
}
