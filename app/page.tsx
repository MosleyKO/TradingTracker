'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import SectionNav from '@/components/SectionNav'
import { calcStats, Trade } from '@/lib/stats'
import { Transaction, totals as cashFlowTotals } from '@/lib/cashflow'
import { Preset, PRESETS, getPresetRange } from '@/lib/dateRange'
import { FinancialAccount, AccountBalance, netWorthCurve } from '@/lib/networth'

const fmt = (n: number) =>
  n >= 0
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

interface ActivityItem {
  date: Date
  label: string
  sub: string
  amount: number
  color: string
}

export default function OverviewPage() {
  const router = useRouter()
  const supabase = createClient()
  const [loading, setLoading] = useState(true)

  const [netWorthCurveData, setNetWorthCurveData] = useState<{ date: string; net: number }[]>([])
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([])
  const [allTrades, setAllTrades] = useState<Trade[]>([])

  const [preset, setPreset] = useState<Preset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      await Promise.all([loadNetWorth(user.id), loadCashFlow(user.id), loadTrading(user.id)])
      setLoading(false)
    }
    init()
  }, [])

  const loadNetWorth = async (userId: string) => {
    const [{ data: accts }, { data: bals }] = await Promise.all([
      supabase.from('financial_accounts').select('*').eq('user_id', userId),
      supabase.from('account_balances').select('account_id, as_of, balance').eq('user_id', userId).order('as_of', { ascending: true }),
    ])
    setNetWorthCurveData(netWorthCurve((accts ?? []) as FinancialAccount[], (bals ?? []) as AccountBalance[]))
  }

  const loadCashFlow = async (userId: string) => {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    setAllTransactions((data ?? []) as Transaction[])
  }

  const loadTrading = async (userId: string) => {
    const { data } = await supabase
      .from('trades')
      .select('*')
      .eq('user_id', userId)
      .order('close_time', { ascending: true })
    const trades: Trade[] = (data ?? []).map((r: any) => ({
      symbol: r.symbol,
      pnl: r.pnl,
      closeTime: new Date(r.close_time),
      openTime: r.open_time ? new Date(r.open_time) : undefined,
      entryPrice: r.entry_price ?? undefined,
      avgExitPrice: r.avg_exit_price ?? undefined,
      totalQty: r.total_qty ?? undefined,
      bestTrimPnl: r.best_trim_pnl ?? undefined,
      trims: r.trims ? r.trims.map((tr: any) => ({ ...tr, time: new Date(tr.time) })) : undefined,
    }))
    setAllTrades(trades)
  }

  // Everything below is derived client-side from the raw data already
  // fetched above — switching periods never re-hits the network.
  const range = useMemo(() => {
    if (preset === 'custom') {
      return {
        start: customStart ? new Date(customStart + 'T00:00:00') : new Date(0),
        end: customEnd ? new Date(customEnd + 'T23:59:59') : new Date(),
      }
    }
    return getPresetRange(preset)
  }, [preset, customStart, customEnd])

  const hasNetWorthData = netWorthCurveData.length > 0
  const hasCashFlowData = allTransactions.length > 0
  const hasTradingData = allTrades.length > 0

  const netWorth = useMemo(() => {
    if (!hasNetWorthData) return null
    const current = netWorthCurveData[netWorthCurveData.length - 1].net
    // Compare to the latest snapshot at/before the period start. Compared as
    // date strings (not Date objects) — snapshot dates are stamped at noon
    // while range.start is midnight of the same calendar day, so a Date
    // comparison would wrongly exclude a snapshot taken ON the period's
    // first day. Falls back to the earliest snapshot if none qualifies
    // (e.g. all history falls inside the selected period).
    const rangeStartStr = `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}-${String(range.start.getDate()).padStart(2, '0')}`
    const priorInRange = [...netWorthCurveData].reverse().find(d => d.date <= rangeStartStr)
    const comparison = priorInRange ?? netWorthCurveData[0]
    const delta = comparison ? current - comparison.net : null
    const sinceLabel = comparison ? new Date(comparison.date + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null
    return { current, delta, sinceLabel }
  }, [netWorthCurveData, hasNetWorthData, range])

  const filteredTransactions = useMemo(
    () => allTransactions.filter(t => {
      const d = new Date(t.date + 'T12:00:00')
      return d >= range.start && d <= range.end
    }),
    [allTransactions, range]
  )
  const cashFlowStats = useMemo(() => cashFlowTotals(filteredTransactions), [filteredTransactions])

  const filteredTrades = useMemo(
    () => allTrades.filter(t => t.closeTime >= range.start && t.closeTime <= range.end),
    [allTrades, range]
  )
  const tradingStats = useMemo(() => calcStats(filteredTrades), [filteredTrades])

  const activity = useMemo(() => {
    const nwActivity: ActivityItem[] = netWorthCurveData
      .filter(d => { const dt = new Date(d.date + 'T12:00:00'); return dt >= range.start && dt <= range.end })
      .map(d => {
        const idx = netWorthCurveData.findIndex(c => c.date === d.date)
        const prevPoint = idx > 0 ? netWorthCurveData[idx - 1] : null
        const delta = prevPoint ? d.net - prevPoint.net : d.net
        return {
          date: new Date(d.date + 'T12:00:00'),
          label: 'Net worth snapshot',
          sub: 'Net Worth',
          amount: delta,
          color: 'var(--blue)',
        }
      })

    const cfActivity: ActivityItem[] = filteredTransactions.map(t => ({
      date: new Date(t.date + 'T12:00:00'),
      label: t.description || t.category || (t.type === 'income' ? 'Income' : 'Expense'),
      sub: 'Cash Flow',
      amount: t.type === 'income' ? t.amount : -t.amount,
      color: t.type === 'income' ? 'var(--green)' : 'var(--red)',
    }))

    const trActivity: ActivityItem[] = filteredTrades.map(t => ({
      date: t.closeTime,
      label: t.symbol,
      sub: 'Trading',
      amount: t.pnl,
      color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)',
    }))

    return [...nwActivity, ...cfActivity, ...trActivity]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 8)
  }, [netWorthCurveData, filteredTransactions, filteredTrades, range])

  if (loading) {
    return (
      <>
        <SectionNav />
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </>
    )
  }

  const periodLabel = PRESETS.find(p => p.key === preset)?.label ?? ''

  return (
    <>
      <SectionNav />
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Overview</h1>
        </div>

        {/* ── Period filter ── */}
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
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
          {/* Net Worth card */}
          <Link href="/net-worth" style={{ textDecoration: 'none' }}>
            <div className="panel" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
              <div className="panel-title">Net Worth</div>
              {netWorth ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: netWorth.current >= 0 ? 'var(--text)' : 'var(--red)' }}>
                    {fmt(netWorth.current)}
                  </div>
                  {netWorth.delta !== null && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: netWorth.delta >= 0 ? 'var(--green)' : 'var(--red)', marginTop: 6 }}>
                      {netWorth.delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorth.delta))} since {netWorth.sinceLabel}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 4 }}>No snapshots yet</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6 }}>Set up Net Worth →</div>
                </>
              )}
            </div>
          </Link>

          {/* Cash Flow card */}
          <Link href="/cash-flow" style={{ textDecoration: 'none' }}>
            <div className="panel" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
              <div className="panel-title">Cash Flow ({periodLabel})</div>
              {hasCashFlowData ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: cashFlowStats.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmt(cashFlowStats.net)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Income <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(cashFlowStats.income)}</span></span>
                    <span style={{ color: 'var(--text-muted)' }}>Expenses <span style={{ color: 'var(--red)', fontWeight: 600 }}>{fmt(cashFlowStats.expense)}</span></span>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 4 }}>No transactions yet</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6 }}>Set up Cash Flow →</div>
                </>
              )}
            </div>
          </Link>

          {/* Trading card */}
          <Link href="/trading" style={{ textDecoration: 'none' }}>
            <div className="panel" style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}>
              <div className="panel-title">Trading ({periodLabel})</div>
              {hasTradingData ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: tradingStats.netPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmt(tradingStats.netPnl)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tradingStats.tradeCount} trades</span>
                    {tradingStats.tradeCount > 0 && (
                      <span style={{ color: tradingStats.winRate >= 0.5 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{pct(tradingStats.winRate)} win rate</span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, color: 'var(--text-muted)', marginTop: 4 }}>No trades yet</div>
                  <div style={{ fontSize: 12, color: 'var(--blue)', marginTop: 6 }}>Set up Trading →</div>
                </>
              )}
            </div>
          </Link>
        </div>

        {/* Recent activity */}
        <div className="panel">
          <div className="panel-title">Activity ({periodLabel})</div>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
              Nothing in this period — try a different date range.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activity.map((a, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, paddingBottom: 10, borderBottom: i < activity.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: a.color, flexShrink: 0 }} />
                  <div style={{ width: 74, fontSize: 11, color: 'var(--text-muted)', flexShrink: 0 }}>
                    {a.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{a.sub}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: a.color, flexShrink: 0 }}>
                    {a.amount >= 0 ? '+' : ''}{fmt(a.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
