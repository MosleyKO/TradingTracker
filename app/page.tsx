'use client'

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { parseTOS } from '@/lib/parseTOS'
import { parseWebull } from '@/lib/parseWebull'
import { calcStats, Trade } from '@/lib/stats'
import { createClient } from '@/lib/supabase'
import EquityChart from '@/components/EquityChart'
import RadarScore from '@/components/RadarScore'
import MonthlyCalendar from '@/components/MonthlyCalendar'

type Account = 'tos' | 'webull'
type Preset = 'today' | 'week' | 'month' | '3month' | 'year' | 'all' | 'custom'

function getPresetRange(preset: Preset): { start: Date; end: Date } {
  const now = new Date()
  const end = new Date(now); end.setHours(23, 59, 59, 999)
  const start = new Date(now); start.setHours(0, 0, 0, 0)

  if (preset === 'today') return { start, end }
  if (preset === 'week') { start.setDate(start.getDate() - 6); return { start, end } }
  if (preset === 'month') { start.setDate(1); return { start, end } }
  if (preset === '3month') { start.setMonth(start.getMonth() - 2); start.setDate(1); return { start, end } }
  if (preset === 'year') { start.setMonth(0); start.setDate(1); return { start, end } }
  return { start: new Date(0), end }
}

export default function Home() {
  const [account, setAccount] = useState<Account>('tos')
  const [tosTrades, setTosTrades] = useState<Trade[]>([])
  const [webullTrades, setWebullTrades] = useState<Trade[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const [preset, setPreset] = useState<Preset>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  type SortKey = 'date' | 'symbol' | 'pnl' | 'pct' | 'qty'
  type SortDir = 'asc' | 'desc'
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  const rawTrades = account === 'tos' ? tosTrades : webullTrades

  // Filtered trades based on date range
  const filteredTrades = useMemo(() => {
    if (rawTrades.length === 0) return []
    let start: Date, end: Date
    if (preset === 'custom') {
      start = customStart ? new Date(customStart + 'T00:00:00') : new Date(0)
      end = customEnd ? new Date(customEnd + 'T23:59:59') : new Date()
    } else {
      ({ start, end } = getPresetRange(preset))
    }
    return rawTrades.filter(t => t.closeTime >= start && t.closeTime <= end)
  }, [rawTrades, preset, customStart, customEnd])

  const stats = useMemo(() => calcStats(filteredTrades), [filteredTrades])

  // Calendar data — always uses ALL raw trades, independent of date filter
  const calendarData = useMemo(() => {
    const dayMap = new Map<string, { pnl: number; trades: number }>()
    for (const t of rawTrades) {
      const day = t.closeTime.toISOString().slice(0, 10)
      const existing = dayMap.get(day) || { pnl: 0, trades: 0 }
      dayMap.set(day, { pnl: existing.pnl + t.pnl, trades: existing.trades + 1 })
    }
    return Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }))
  }, [rawTrades])
  const hasData = rawTrades.length > 0

  // Check auth + load saved trades on mount
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      setUserEmail(user.email ?? null)
      await loadTrades(user.id)
      setLoadingData(false)
    }
    init()
  }, [])

  const mapRow = (r: any): Trade => ({
    symbol: r.symbol,
    pnl: r.pnl,
    closeTime: new Date(r.close_time),
    openTime: r.open_time ? new Date(r.open_time) : undefined,
    entryPrice: r.entry_price ?? undefined,
    avgExitPrice: r.avg_exit_price ?? undefined,
    totalQty: r.total_qty ?? undefined,
    bestTrimPnl: r.best_trim_pnl ?? undefined,
    trims: r.trims ? r.trims.map((tr: any) => ({ ...tr, time: new Date(tr.time) })) : undefined,
  })

  const loadTrades = async (userId: string) => {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('close_time', { ascending: true })

    if (error || !data) return
    setTosTrades(data.filter((r: any) => r.account_type === 'tos').map(mapRow))
    setWebullTrades(data.filter((r: any) => r.account_type === 'webull').map(mapRow))
  }

  const saveTrades = async (trades: Trade[], acct: Account) => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('trades').delete().eq('user_id', user.id).eq('account_type', acct)

    const rows = trades.map(t => ({
      user_id: user.id,
      account_type: acct,
      symbol: t.symbol,
      pnl: t.pnl,
      close_time: t.closeTime.toISOString(),
      open_time: t.openTime?.toISOString() ?? null,
      entry_price: t.entryPrice ?? null,
      avg_exit_price: t.avgExitPrice ?? null,
      total_qty: t.totalQty ?? null,
      best_trim_pnl: t.bestTrimPnl ?? null,
      trims: t.trims ? t.trims.map(tr => ({ ...tr, time: tr.time.toISOString() })) : null,
    }))

    await supabase.from('trades').insert(rows)
    setSaving(false)
  }

  const handleFile = useCallback((file: File, acct: Account) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const text = e.target?.result as string
      let trades: Trade[]

      if (acct === 'tos') {
        const completed = parseTOS(text)
        trades = completed.map(t => ({
          symbol: `${t.symbol} ${t.strike}${t.type[0]}`,
          pnl: t.pnl,
          closeTime: t.closeTime,
          openTime: t.openTime,
          entryPrice: t.openPrice,
          avgExitPrice: t.avgClosePrice,
          bestTrimPnl: t.bestTrimPnl,
          totalQty: t.totalQty,
          trims: t.trims.map(tr => ({ qty: tr.qty, price: tr.closePrice, pnl: tr.pnl, time: tr.time })),
        }))
        setTosTrades(trades)
      } else {
        const completed = parseWebull(text)
        trades = completed.map(t => ({
          symbol: t.symbol,
          pnl: t.totalPnl,
          closeTime: t.lastSellTime,
          openTime: t.buyTime,
          entryPrice: t.entryPrice,
          avgExitPrice: t.avgExitPrice,
          bestTrimPnl: t.bestTrimPnl,
          totalQty: t.totalQty,
          trims: t.trims.map(tr => ({ qty: tr.qty, price: tr.sellPrice, pnl: tr.pnl, time: tr.time })),
        }))
        setWebullTrades(trades)
      }

      await saveTrades(trades, acct)
    }
    reader.readAsText(file)
  }, [account])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file, account)
  }, [account, handleFile])

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file, account)
    e.target.value = ''
  }

  const fmt = (n: number) =>
    n >= 0 ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
    `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`

  const PRESETS: { key: Preset; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: '3month', label: '3 Months' },
    { key: 'year', label: 'This Year' },
    { key: 'all', label: 'All Time' },
    { key: 'custom', label: 'Custom' },
  ]

  if (loadingData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Trade Journal</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div className="tabs">
            <button className={`tab ${account === 'tos' ? 'active' : ''}`} onClick={() => { setAccount('tos'); setExpandedRows(new Set()) }}>
              ThinkorSwim
            </button>
            <button className={`tab ${account === 'webull' ? 'active' : ''}`} onClick={() => { setAccount('webull'); setExpandedRows(new Set()) }}>
              Webull
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{userEmail}</div>
          <button onClick={handleSignOut} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 12px', fontSize: 12
          }}>Sign out</button>
        </div>
      </div>

      {/* Upload */}
      {!hasData ? (
        <div
          className={`upload-area ${dragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ padding: '24px 48px', marginBottom: 16 }}
        >
          <div className="upload-icon" style={{ fontSize: 28, marginBottom: 6 }}>📂</div>
          <h3 style={{ fontSize: 14 }}>
            {saving ? 'Saving...' : `Upload ${account === 'tos' ? 'ThinkorSwim Account Statement' : 'Webull Orders Records'} CSV`}
          </h3>
          <p style={{ fontSize: 12 }}>{saving ? 'Storing your trades...' : 'Click or drag & drop — saved automatically'}</p>
        </div>
      ) : (
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 16px', background: 'var(--surface)', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 500,
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <span style={{ fontSize: 16 }}>+</span>
            {saving ? 'Saving...' : 'Update Trades'}
          </button>
          {saving && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Storing your trades...</span>}
        </div>
      )}
      <input ref={fileInputRef} type="file" accept=".csv" onChange={onFileInput} style={{ display: 'none' }} />

      {/* Date range selector */}
      {hasData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              style={{
                padding: '5px 14px', borderRadius: 6, border: '1px solid var(--border)',
                background: preset === p.key ? 'var(--blue)' : 'var(--surface)',
                color: preset === p.key ? '#fff' : 'var(--text-muted)',
                cursor: 'pointer', fontSize: 12, fontWeight: preset === p.key ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >{p.label}</button>
          ))}
          {preset === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 4 }}>
              <input
                type="date"
                value={customStart}
                onChange={e => setCustomStart(e.target.value)}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', padding: '4px 10px', fontSize: 12
                }}
              />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
              <input
                type="date"
                value={customEnd}
                onChange={e => setCustomEnd(e.target.value)}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  borderRadius: 6, color: 'var(--text)', padding: '4px 10px', fontSize: 12
                }}
              />
            </div>
          )}
          {filteredTrades.length !== rawTrades.length && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>
              Showing {filteredTrades.length} of {rawTrades.length} trades
            </span>
          )}
        </div>
      )}

      {!hasData ? (
        <div className="empty-state">
          <h2>No data yet</h2>
          <p>Upload a CSV above to see your trading stats</p>
        </div>
      ) : filteredTrades.length === 0 ? (
        <div className="empty-state">
          <h2>No trades in this period</h2>
          <p>Try a different date range</p>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-label">Net P&amp;L <span style={{color:'var(--text-muted)',fontSize:10}}>({stats.tradeCount} trades)</span></div>
              <div className={`stat-value ${stats.netPnl >= 0 ? 'green' : 'red'}`}>{fmt(stats.netPnl)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Trade Win %</div>
              <div className={`stat-value ${stats.winRate >= 0.5 ? 'green' : 'red'}`}>{pct(stats.winRate)}</div>
              <div className="stat-sub">{Math.round(stats.winRate * stats.tradeCount)}W / {stats.tradeCount - Math.round(stats.winRate * stats.tradeCount)}L</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Profit Factor</div>
              <div className={`stat-value ${stats.profitFactor >= 1 ? 'green' : 'red'}`}>{stats.profitFactor.toFixed(2)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Day Win %</div>
              <div className={`stat-value ${stats.dayWinRate >= 0.5 ? 'green' : 'red'}`}>{pct(stats.dayWinRate)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg Win / Loss</div>
              <div className="stat-value" style={{fontSize:16,paddingTop:4}}>
                <span className="badge-win">{fmt(stats.avgWin)}</span>
                <span style={{color:'var(--text-muted)',margin:'0 4px'}}>/</span>
                <span className="badge-loss">-{fmt(stats.avgLoss)}</span>
              </div>
              <div className="gauge-row">
                <div className="gauge-bar">
                  <div className="gauge-fill" style={{ width: `${Math.min((stats.avgWin / (stats.avgWin + stats.avgLoss || 1)) * 100, 100)}%` }} />
                </div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Max Drawdown</div>
              <div className="stat-value red">-{fmt(stats.maxDrawdown)}</div>
            </div>
          </div>

          {/* Bottom grid */}
          <div className="bottom-grid">
            <RadarScore stats={stats} />
            <div className="panel">
              <div className="panel-title">Daily Net Cumulative P&amp;L</div>
              <EquityChart data={stats.equityCurve} />
            </div>
            <div className="panel">
              <div className="panel-title">Monthly P&amp;L Calendar</div>
              <MonthlyCalendar data={calendarData} />
            </div>
          </div>

          {/* Day of week + Ticker breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            {/* Day of week */}
            <div className="panel">
              <div className="panel-title">P&amp;L by Day of Week</div>
              {(() => {
                const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                const dayData = days.map(day => {
                  const dayTrades = filteredTrades.filter(t => days[t.closeTime.getDay()] === day)
                  const pnl = dayTrades.reduce((s, t) => s + t.pnl, 0)
                  const wins = dayTrades.filter(t => t.pnl > 0).length
                  return { day: day.slice(0,3), pnl, trades: dayTrades.length, wins }
                }).filter(d => d.trades > 0)
                const max = Math.max(...dayData.map(d => Math.abs(d.pnl)), 1)
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {dayData.map(d => (
                      <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 32, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{d.day}</div>
                        <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 4,
                            width: `${(Math.abs(d.pnl) / max) * 100}%`,
                            background: d.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                          }} />
                        </div>
                        <div style={{ width: 80, fontSize: 12, textAlign: 'right', color: d.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                          {d.pnl >= 0 ? '+' : ''}{fmt(d.pnl)}
                        </div>
                        <div style={{ width: 48, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                          {d.wins}/{d.trades}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>

            {/* Ticker breakdown */}
            <div className="panel">
              <div className="panel-title">P&amp;L by Ticker</div>
              {(() => {
                const tickerMap = new Map<string, { pnl: number; trades: number; wins: number }>()
                for (const t of filteredTrades) {
                  const sym = t.symbol.split(' ')[0]
                  const existing = tickerMap.get(sym) || { pnl: 0, trades: 0, wins: 0 }
                  tickerMap.set(sym, {
                    pnl: existing.pnl + t.pnl,
                    trades: existing.trades + 1,
                    wins: existing.wins + (t.pnl > 0 ? 1 : 0),
                  })
                }
                const tickers = Array.from(tickerMap.entries())
                  .map(([sym, v]) => ({ sym, ...v }))
                  .sort((a, b) => b.pnl - a.pnl)
                const max = Math.max(...tickers.map(t => Math.abs(t.pnl)), 1)
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {tickers.map(t => (
                      <div key={t.sym} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 52, fontSize: 12, color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{t.sym}</div>
                        <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 4,
                            width: `${(Math.abs(t.pnl) / max) * 100}%`,
                            background: t.pnl >= 0 ? 'var(--green)' : 'var(--red)',
                          }} />
                        </div>
                        <div style={{ width: 80, fontSize: 12, textAlign: 'right', color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                          {t.pnl >= 0 ? '+' : ''}{fmt(t.pnl)}
                        </div>
                        <div style={{ width: 48, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                          {t.wins}/{t.trades}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Trade log */}
          <div className="panel" style={{marginTop:12}}>
            <div className="panel-title">Trade Log</div>
            <table className="trade-table">
              <thead>
                <tr>
                  <th style={{width:32}}></th>
                  {([
                    { key: 'date', label: 'Date' },
                    { key: 'symbol', label: 'Symbol' },
                    { key: null, label: 'Entry' },
                    { key: null, label: 'Avg Exit' },
                    { key: 'qty', label: 'Qty' },
                    { key: 'pnl', label: 'Total P&L' },
                    { key: 'pct', label: 'Return %' },
                    { key: null, label: 'Result' },
                  ] as { key: SortKey | null; label: string }[]).map(col => (
                    <th
                      key={col.label}
                      onClick={() => {
                        if (!col.key) return
                        if (sortKey === col.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                        else { setSortKey(col.key); setSortDir('desc') }
                        setExpandedRows(new Set())
                      }}
                      style={{ cursor: col.key ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
                    >
                      {col.label}
                      {col.key && sortKey === col.key && <span style={{ marginLeft: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
                      {col.key && sortKey !== col.key && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.3 }}>⇅</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...stats.trades].sort((a, b) => {
                    const pctA = a.entryPrice && a.avgExitPrice ? (a.avgExitPrice - a.entryPrice) / a.entryPrice : 0
                    const pctB = b.entryPrice && b.avgExitPrice ? (b.avgExitPrice - b.entryPrice) / b.entryPrice : 0
                    let cmp = 0
                    if (sortKey === 'date') cmp = a.closeTime.getTime() - b.closeTime.getTime()
                    else if (sortKey === 'symbol') cmp = a.symbol.localeCompare(b.symbol)
                    else if (sortKey === 'pnl') cmp = a.pnl - b.pnl
                    else if (sortKey === 'pct') cmp = pctA - pctB
                    else if (sortKey === 'qty') cmp = (a.totalQty ?? 0) - (b.totalQty ?? 0)
                    return sortDir === 'asc' ? cmp : -cmp
                  })
                  return sorted.map((t, i) => {
                  const hasTrims = t.trims && t.trims.length > 1
                  const isExpanded = expandedRows.has(i)
                  const toggle = () => {
                    if (!hasTrims) return
                    setExpandedRows(prev => {
                      const next = new Set(prev)
                      next.has(i) ? next.delete(i) : next.add(i)
                      return next
                    })
                  }
                  const tradePct = t.entryPrice && t.avgExitPrice
                    ? ((t.avgExitPrice - t.entryPrice) / t.entryPrice * 100)
                    : null
                  return (
                    <React.Fragment key={i}>
                      <tr onClick={toggle} style={{ cursor: hasTrims ? 'pointer' : 'default' }}>
                        <td style={{textAlign:'center', color:'var(--text-muted)', fontSize:11, userSelect:'none'}}>
                          {hasTrims ? (isExpanded ? '▾' : '▸') : ''}
                        </td>
                        <td style={{color:'var(--text-muted)'}}>{t.closeTime.toLocaleDateString()}</td>
                        <td style={{fontWeight:600}}>
                          {t.symbol}
                          {hasTrims && <span style={{marginLeft:8, fontSize:10, color:'var(--text-muted)', fontWeight:400}}>{t.trims!.length} trims</span>}
                        </td>
                        <td style={{color:'var(--text-muted)'}}>{t.entryPrice ? `$${t.entryPrice.toFixed(2)}` : '—'}</td>
                        <td style={{color:'var(--text-muted)'}}>{t.avgExitPrice ? `$${t.avgExitPrice.toFixed(2)}` : '—'}</td>
                        <td style={{color:'var(--text-muted)'}}>{t.totalQty ?? '—'}</td>
                        <td className={t.pnl >= 0 ? 'badge-win' : 'badge-loss'}>{fmt(t.pnl)}</td>
                        <td className={tradePct !== null ? (tradePct >= 0 ? 'badge-win' : 'badge-loss') : ''}>
                          {tradePct !== null ? `${tradePct >= 0 ? '+' : ''}${tradePct.toFixed(1)}%` : '—'}
                        </td>
                        <td className={t.pnl >= 0 ? 'badge-win' : 'badge-loss'}>{t.pnl >= 0 ? 'WIN' : 'LOSS'}</td>
                      </tr>
                      {hasTrims && isExpanded && t.trims!.map((tr, ti) => {
                        const trimPct = t.entryPrice ? ((tr.price - t.entryPrice) / t.entryPrice * 100) : null
                        return (
                          <tr key={`${i}-trim-${ti}`} style={{background:'rgba(255,255,255,0.025)'}}>
                            <td></td>
                            <td style={{color:'var(--text-muted)', fontSize:11, paddingLeft:12}}>
                              {tr.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                            </td>
                            <td style={{color:'var(--text-muted)', fontSize:11, paddingLeft:12}}>
                              ↳ Trim {ti + 1}
                              {tr.pnl === t.bestTrimPnl && <span style={{marginLeft:6, color:'#f0a500', fontSize:10}}>★ best</span>}
                            </td>
                            <td></td>
                            <td style={{color:'var(--text-muted)', fontSize:11}}>${tr.price.toFixed(2)}</td>
                            <td style={{color:'var(--text-muted)', fontSize:11}}>{tr.qty}</td>
                            <td className={tr.pnl >= 0 ? 'badge-win' : 'badge-loss'} style={{fontSize:11}}>{fmt(tr.pnl)}</td>
                            <td className={trimPct !== null ? (trimPct >= 0 ? 'badge-win' : 'badge-loss') : ''} style={{fontSize:11}}>
                              {trimPct !== null ? `${trimPct >= 0 ? '+' : ''}${trimPct.toFixed(1)}%` : '—'}
                            </td>
                            <td></td>
                          </tr>
                        )
                      })}
                    </React.Fragment>
                  )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
