'use client'

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { parseTOS } from '@/lib/parseTOS'
import { parseWebull } from '@/lib/parseWebull'
import { calcStats, Stats, Trade } from '@/lib/stats'
import { createClient } from '@/lib/supabase'
import EquityChart from '@/components/EquityChart'
import RadarScore from '@/components/RadarScore'
import CalendarHeatmap from '@/components/CalendarHeatmap'

type Account = 'tos' | 'webull'

export default function Home() {
  const [account, setAccount] = useState<Account>('tos')
  const [tosStats, setTosStats] = useState<Stats | null>(null)
  const [webullStats, setWebullStats] = useState<Stats | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  const stats = account === 'tos' ? tosStats : webullStats

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

  const loadTrades = async (userId: string) => {
    const { data, error } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('close_time', { ascending: true })

    if (error || !data) return

    const tosTrades: Trade[] = data
      .filter((r: any) => r.account_type === 'tos')
      .map((r: any) => ({ symbol: r.symbol, pnl: r.pnl, closeTime: new Date(r.close_time) }))

    const webullTrades: Trade[] = data
      .filter((r: any) => r.account_type === 'webull')
      .map((r: any) => ({ symbol: r.symbol, pnl: r.pnl, closeTime: new Date(r.close_time) }))

    if (tosTrades.length) setTosStats(calcStats(tosTrades))
    if (webullTrades.length) setWebullStats(calcStats(webullTrades))
  }

  const saveTrades = async (trades: Trade[], acct: Account) => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // Delete existing trades for this account type then re-insert
    await supabase.from('trades').delete().eq('user_id', user.id).eq('account_type', acct)

    const rows = trades.map(t => ({
      user_id: user.id,
      account_type: acct,
      symbol: t.symbol,
      pnl: t.pnl,
      close_time: t.closeTime.toISOString(),
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
          trims: t.trims.map(tr => ({
            qty: tr.qty,
            price: tr.closePrice,
            pnl: tr.pnl,
            time: tr.time,
          })),
        }))
        setTosStats(calcStats(trades))
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
          trims: t.trims.map(tr => ({
            qty: tr.qty,
            price: tr.sellPrice,
            pnl: tr.pnl,
            time: tr.time,
          })),
        }))
        setWebullStats(calcStats(trades))
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
            <button className={`tab ${account === 'tos' ? 'active' : ''}`} onClick={() => setAccount('tos')}>
              ThinkorSwim
            </button>
            <button className={`tab ${account === 'webull' ? 'active' : ''}`} onClick={() => setAccount('webull')}>
              Webull
            </button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{userEmail}</div>
          <button onClick={handleSignOut} style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 12px', fontSize: 12
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Upload */}
      <div
        className={`upload-area ${dragOver ? 'drag-over' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="upload-icon">📂</div>
        <h3>
          {saving ? 'Saving...' : `Drop your ${account === 'tos' ? 'ThinkorSwim Account Statement' : 'Webull Orders Records'} CSV`}
        </h3>
        <p>{saving ? 'Storing your trades...' : 'or click to browse — your data is saved automatically'}</p>
        <input ref={fileInputRef} type="file" accept=".csv" onChange={onFileInput} style={{ display: 'none' }} />
      </div>

      {!stats ? (
        <div className="empty-state">
          <h2>No data yet</h2>
          <p>Upload a CSV above to see your trading stats</p>
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
                  <div className="gauge-fill" style={{
                    width: `${Math.min((stats.avgWin / (stats.avgWin + stats.avgLoss || 1)) * 100, 100)}%`
                  }} />
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
              <div className="panel-title">Progress Tracker</div>
              <CalendarHeatmap data={stats.calendarData} />
            </div>
          </div>

          {/* Trade log */}
          <div className="panel" style={{marginTop:12}}>
            <div className="panel-title">Trade Log</div>
            <table className="trade-table">
              <thead>
                <tr>
                  <th style={{width:32}}></th>
                  <th>Date</th>
                  <th>Symbol</th>
                  <th>Entry</th>
                  <th>Avg Exit</th>
                  <th>Qty</th>
                  <th>Total P&amp;L</th>
                  <th>Return %</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {[...stats.trades].reverse().map((t, i) => {
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
                  // Overall % = (avgExit - entry) / entry * 100
                  const tradePct = t.entryPrice && t.avgExitPrice
                    ? ((t.avgExitPrice - t.entryPrice) / t.entryPrice * 100)
                    : null
                  return (
                    <React.Fragment key={i}>
                      <tr
                        onClick={toggle}
                        style={{ cursor: hasTrims ? 'pointer' : 'default' }}
                      >
                        <td style={{textAlign:'center', color:'var(--text-muted)', fontSize:11, userSelect:'none'}}>
                          {hasTrims ? (isExpanded ? '▾' : '▸') : ''}
                        </td>
                        <td style={{color:'var(--text-muted)'}}>{t.closeTime.toLocaleDateString()}</td>
                        <td style={{fontWeight:600}}>
                          {t.symbol}
                          {hasTrims && (
                            <span style={{marginLeft:8, fontSize:10, color:'var(--text-muted)', fontWeight:400}}>
                              {t.trims!.length} trims
                            </span>
                          )}
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
                        const trimPct = t.entryPrice
                          ? ((tr.price - t.entryPrice) / t.entryPrice * 100)
                          : null
                        return (
                          <tr key={`${i}-trim-${ti}`} style={{background:'rgba(255,255,255,0.025)'}}>
                            <td></td>
                            <td style={{color:'var(--text-muted)', fontSize:11, paddingLeft:12}}>
                              {tr.time.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}
                            </td>
                            <td style={{color:'var(--text-muted)', fontSize:11, paddingLeft:12}}>
                              ↳ Trim {ti + 1}
                              {tr.pnl === t.bestTrimPnl && (
                                <span style={{marginLeft:6, color:'#f0a500', fontSize:10}}>★ best</span>
                              )}
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
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
