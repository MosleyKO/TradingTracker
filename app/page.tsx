'use client'

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { parseTOS } from '@/lib/parseTOS'
import { parseWebull } from '@/lib/parseWebull'
import { calcStats, Trade } from '@/lib/stats'
import { createClient } from '@/lib/supabase'
import EquityChart from '@/components/EquityChart'
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
  const [tosStartingBalance, setTosStartingBalance] = useState<number | null>(null)
  const [webullStartingBalance, setWebullStartingBalance] = useState<number | null>(null)
  const [balanceInput, setBalanceInput] = useState('')
  const [editingBalance, setEditingBalance] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  const rawTrades = account === 'tos' ? tosTrades : webullTrades
  const startingBalance = account === 'tos' ? tosStartingBalance : webullStartingBalance

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
      await Promise.all([loadTrades(user.id), loadSettings(user.id)])
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

  const loadSettings = async (userId: string) => {
    const { data } = await supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
    if (data) {
      setTosStartingBalance(data.tos_starting_balance ?? null)
      setWebullStartingBalance(data.webull_starting_balance ?? null)
    }
  }

  const saveStartingBalance = async (value: number) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const field = account === 'tos' ? 'tos_starting_balance' : 'webull_starting_balance'
    await supabase.from('user_settings').upsert({ user_id: user.id, [field]: value }, { onConflict: 'user_id' })
    if (account === 'tos') setTosStartingBalance(value)
    else setWebullStartingBalance(value)
  }

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
    if (!user) { setSaving(false); return }

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

    await supabase.from('trades').delete().eq('user_id', user.id).eq('account_type', acct)
    await supabase.from('trades').insert(rows)
    setSaving(false)
  }

  const handleFile = useCallback((file: File, acct: Account) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const text = e.target?.result as string
      let trades: Trade[]

      const merge = (existing: Trade[], incoming: Trade[]): Trade[] => {
        const key = (t: Trade) => `${t.symbol}|${t.closeTime.toISOString()}`
        const seen = new Set(existing.map(key))
        return [...existing, ...incoming.filter(t => !seen.has(key(t)))]
      }

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
        const merged = merge(tosTrades, trades)
        setTosTrades(merged)
        await saveTrades(merged, acct)
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
        const merged = merge(webullTrades, trades)
        setWebullTrades(merged)
        await saveTrades(merged, acct)
      }
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

  // Period comparison
  const periodPnl = useMemo(() => {
    if (preset === 'all' || preset === 'custom' || rawTrades.length === 0) return null
    const now = new Date()
    const cur = getPresetRange(preset)
    const duration = cur.end.getTime() - cur.start.getTime()
    const prevEnd = new Date(cur.start.getTime() - 1)
    const prevStart = new Date(prevEnd.getTime() - duration)
    const prevTrades = rawTrades.filter(t => t.closeTime >= prevStart && t.closeTime <= prevEnd)
    const prevPnl = prevTrades.reduce((s, t) => s + t.pnl, 0)
    if (prevPnl === 0) return null
    return ((stats.netPnl - prevPnl) / Math.abs(prevPnl)) * 100
  }, [filteredTrades, preset, rawTrades])

  // Day of week stats
  const dowStats = useMemo(() => {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
    return days.map(day => {
      const dayTrades = filteredTrades.filter(t => days[t.closeTime.getDay()] === day)
      const pnl = dayTrades.reduce((s, t) => s + t.pnl, 0)
      const wins = dayTrades.filter(t => t.pnl > 0).length
      return { day, short: day.slice(0,3), pnl, trades: dayTrades.length, wins }
    }).filter(d => d.trades > 0)
  }, [filteredTrades])

  const bestDay = dowStats.length ? dowStats.reduce((a, b) => a.pnl > b.pnl ? a : b) : null
  const worstDay = dowStats.length ? dowStats.reduce((a, b) => a.pnl < b.pnl ? a : b) : null

  // Ticker stats
  const tickerStats = useMemo(() => {
    const map = new Map<string, { pnl: number; trades: number; wins: number }>()
    for (const t of filteredTrades) {
      const sym = t.symbol.split(' ')[0]
      const e = map.get(sym) || { pnl: 0, trades: 0, wins: 0 }
      map.set(sym, { pnl: e.pnl + t.pnl, trades: e.trades + 1, wins: e.wins + (t.pnl > 0 ? 1 : 0) })
    }
    return Array.from(map.entries()).map(([sym, v]) => ({ sym, ...v })).sort((a, b) => b.pnl - a.pnl)
  }, [filteredTrades])

  // Insights
  const insights = useMemo(() => {
    const result = []
    // Worst day to trade
    if (worstDay && worstDay.pnl < 0) {
      result.push({
        icon: 'warning',
        title: 'Biggest Opportunity',
        action: `Avoid ${worstDay.day}s`,
        stat: fmt(worstDay.pnl),
        detail: `${worstDay.wins}W / ${worstDay.trades - worstDay.wins}L`,
        positive: false,
      })
    }
    // Strongest ticker
    if (tickerStats.length > 0) {
      const best = tickerStats[0]
      result.push({
        icon: 'trophy',
        title: 'Strongest Ticker',
        action: best.sym,
        stat: fmt(best.pnl),
        detail: `${best.wins}W / ${best.trades} trades`,
        positive: true,
      })
    }
    // Most consistent day
    if (bestDay) {
      result.push({
        icon: 'calendar',
        title: 'Most Consistent Day',
        action: bestDay.day,
        stat: fmt(bestDay.pnl),
        detail: `${bestDay.wins}W / ${bestDay.trades} trades`,
        positive: true,
      })
    }
    return result
  }, [worstDay, bestDay, tickerStats])

  if (loadingData) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Loading...
      </div>
    )
  }

  return (
    <div className="container">
      {/* ── Header ── */}
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

      {/* ── Upload ── */}
      {!hasData ? (
        <div
          className={`upload-area ${dragOver ? 'drag-over' : ''}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          style={{ padding: '24px 48px', marginBottom: 24 }}
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

      {/* ── Date filter ── */}
      {hasData && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
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
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '4px 10px', fontSize: 12 }} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '4px 10px', fontSize: 12 }} />
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
          {/* ════════════════════════════════════════════════
              ROW 1 — Hero: Net P&L + Equity Curve
          ════════════════════════════════════════════════ */}
          <div className="panel" style={{ marginBottom: 24, display: 'flex', alignItems: 'stretch', gap: 0, padding: 0, overflow: 'hidden' }}>
            {/* Left: P&L summary */}
            <div style={{ width: 230, flexShrink: 0, padding: 24, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                Net P&amp;L
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1, color: stats.netPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {fmt(stats.netPnl)}
              </div>
              {/* Account Growth % */}
              {startingBalance && startingBalance > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {(() => {
                    const growth = (stats.netPnl / startingBalance) * 100
                    return (
                      <span style={{ fontSize: 13, fontWeight: 600, color: growth >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {growth >= 0 ? '+' : ''}{growth.toFixed(2)}% account growth
                      </span>
                    )
                  })()}
                  <button
                    onClick={() => { setBalanceInput(String(startingBalance)); setEditingBalance(true) }}
                    style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1 }}
                    title="Edit starting balance"
                  >✎</button>
                </div>
              ) : (
                !editingBalance ? (
                  <button
                    onClick={() => { setBalanceInput(''); setEditingBalance(true) }}
                    style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 12, padding: 0, textAlign: 'left', marginTop: 2 }}
                  >+ Set starting balance</button>
                ) : null
              )}
              {editingBalance && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                  <input
                    type="number"
                    placeholder="e.g. 10000"
                    value={balanceInput}
                    onChange={e => setBalanceInput(e.target.value)}
                    autoFocus
                    style={{ width: 100, padding: '4px 8px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }}
                  />
                  <button
                    onClick={async () => {
                      const val = parseFloat(balanceInput)
                      if (!isNaN(val) && val > 0) { await saveStartingBalance(val) }
                      setEditingBalance(false)
                    }}
                    style={{ padding: '4px 10px', background: 'var(--blue)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 12, cursor: 'pointer' }}
                  >Save</button>
                  <button
                    onClick={() => setEditingBalance(false)}
                    style={{ padding: '4px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}
                  >✕</button>
                </div>
              )}
              {periodPnl !== null && (
                <div style={{ fontSize: 12, color: periodPnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
                  {periodPnl >= 0 ? '▲' : '▼'} {Math.abs(periodPnl).toFixed(1)}% vs prev period
                </div>
              )}
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                {stats.tradeCount} trades
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--green)' }}>{Math.round(stats.winRate * stats.tradeCount)}W</span>
                {' / '}
                <span style={{ color: 'var(--red)' }}>{stats.tradeCount - Math.round(stats.winRate * stats.tradeCount)}L</span>
              </div>
            </div>
            {/* Right: Equity curve */}
            <div style={{ flex: 1, padding: '16px 20px 12px 20px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 8 }}>
                Equity Curve
              </div>
              <EquityChart data={stats.equityCurve} />
            </div>
          </div>

          {/* ════════════════════════════════════════════════
              ROW 2 — KPI Cards (5 metrics)
          ════════════════════════════════════════════════ */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 24 }}>
            {/* Trade Win % */}
            <div className="stat-card">
              <div className="stat-label">Trade Win %</div>
              <div className={`stat-value ${stats.winRate >= 0.5 ? 'green' : 'red'}`}>{pct(stats.winRate)}</div>
              <div className="stat-sub">{Math.round(stats.winRate * stats.tradeCount)}W / {stats.tradeCount - Math.round(stats.winRate * stats.tradeCount)}L</div>
            </div>
            {/* Profit Factor */}
            <div className="stat-card">
              <div className="stat-label">Profit Factor</div>
              <div className={`stat-value ${stats.profitFactor >= 1 ? 'green' : 'red'}`}>{stats.profitFactor.toFixed(2)}</div>
              <div className="stat-sub">{stats.profitFactor >= 1.5 ? 'Strong' : stats.profitFactor >= 1 ? 'Positive' : 'Negative'}</div>
            </div>
            {/* Avg Win / Loss */}
            <div className="stat-card">
              <div className="stat-label">Avg Win / Avg Loss</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{fmt(stats.avgWin)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>/</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>-{fmt(stats.avgLoss)}</span>
              </div>
              <div className="gauge-row" style={{ marginTop: 2 }}>
                <div className="gauge-bar">
                  <div className="gauge-fill" style={{ width: `${Math.min((stats.avgWin / (stats.avgWin + stats.avgLoss || 1)) * 100, 100)}%` }} />
                </div>
              </div>
            </div>
            {/* Max Drawdown */}
            <div className="stat-card">
              <div className="stat-label">Max Drawdown</div>
              <div className="stat-value red">-{fmt(stats.maxDrawdown)}</div>
            </div>
            {/* Recovery Factor */}
            <div className="stat-card">
              <div className="stat-label">Recovery Factor</div>
              <div className={`stat-value ${stats.recoveryFactor >= 1 ? 'green' : 'red'}`}>
                {stats.recoveryFactor.toFixed(2)}
              </div>
              <div className="stat-sub">{stats.recoveryFactor >= 2 ? 'Excellent' : stats.recoveryFactor >= 1 ? 'Good' : 'Poor'}</div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════
              ROW 3 — Calendar (60%) + Day & Ticker (40%)
          ════════════════════════════════════════════════ */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24, marginBottom: 24 }}>
            {/* Calendar */}
            <div className="panel">
              <div className="panel-title">Monthly P&amp;L Calendar</div>
              <MonthlyCalendar data={calendarData} />
            </div>

            {/* Right column: Day of Week + Ticker stacked */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Day of Week */}
              <div className="panel" style={{ flex: 1 }}>
                <div className="panel-title">P&amp;L by Day of Week</div>
                {(() => {
                  const max = Math.max(...dowStats.map(d => Math.abs(d.pnl)), 1)
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {dowStats.map(d => (
                        <div key={d.day} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 30, fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>{d.short}</div>
                          <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 4, width: `${(Math.abs(d.pnl) / max) * 100}%`, background: d.pnl >= 0 ? 'var(--green)' : 'var(--red)' }} />
                          </div>
                          <div style={{ width: 76, fontSize: 12, textAlign: 'right', color: d.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                            {d.pnl >= 0 ? '+' : ''}{fmt(d.pnl)}
                          </div>
                          <div style={{ width: 36, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                            {d.wins}/{d.trades}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </div>

              {/* Ticker breakdown */}
              <div className="panel" style={{ flex: 1 }}>
                <div className="panel-title">P&amp;L by Ticker</div>
                <div className="subtle-scroll" style={{ maxHeight: 220, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(() => {
                    const max = Math.max(...tickerStats.map(t => Math.abs(t.pnl)), 1)
                    return tickerStats.map(t => (
                      <div key={t.sym} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 48, fontSize: 12, color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{t.sym}</div>
                        <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 4, width: `${(Math.abs(t.pnl) / max) * 100}%`, background: t.pnl >= 0 ? 'var(--green)' : 'var(--red)' }} />
                        </div>
                        <div style={{ width: 76, fontSize: 12, textAlign: 'right', color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                          {t.pnl >= 0 ? '+' : ''}{fmt(t.pnl)}
                        </div>
                        <div style={{ width: 36, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                          {t.wins}/{t.trades}
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            </div>
          </div>

          {/* ════════════════════════════════════════════════
              ROW 4 — Score + Insights (same row)
          ════════════════════════════════════════════════ */}
          {insights.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 12 }}>
              Insights
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${insights.length}, 1fr)`, gap: 16 }}>
                {insights.map((ins, i) => (
                  <div key={i} className="panel" style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: 20 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: ins.positive ? 'rgba(38,201,122,0.12)' : 'rgba(224,92,92,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {ins.icon === 'warning' && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      )}
                      {ins.icon === 'trophy' && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="8 21 12 17 16 21"/><line x1="12" y1="17" x2="12" y2="11"/><path d="M7 4H4a2 2 0 0 0-2 2v1a5 5 0 0 0 5 5h10a5 5 0 0 0 5-5V6a2 2 0 0 0-2-2h-3"/><rect x="7" y="2" width="10" height="6" rx="1"/>
                        </svg>
                      )}
                      {ins.icon === 'calendar' && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500, marginBottom: 4 }}>{ins.title}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{ins.action}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: ins.positive ? 'var(--green)' : 'var(--red)' }}>{ins.stat}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{ins.detail}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          )}

          {/* ════════════════════════════════════════════════
              ROW 5 — Trade Log
          ════════════════════════════════════════════════ */}
          <div className="panel">
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
