'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import SectionNav from '@/components/SectionNav'
import { calcStats, Stats, Trade } from '@/lib/stats'
import { Transaction, totals as cashFlowTotals } from '@/lib/cashflow'
import { getPresetRange } from '@/lib/dateRange'
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

  const [netWorth, setNetWorth] = useState<{ current: number; delta: number | null } | null>(null)
  const [cashFlowMonth, setCashFlowMonth] = useState<{ income: number; expense: number; net: number } | null>(null)
  const [hasCashFlowData, setHasCashFlowData] = useState(false)
  const [tradingStats, setTradingStats] = useState<Stats | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      // Each loader returns its own activity slice; combined and set ONCE
      // here rather than each loader mutating shared state independently —
      // that incremental-merge approach duplicated entries whenever this
      // effect ran more than once (e.g. React Strict Mode's dev double-invoke).
      const [nwActivity, cfActivity, trActivity] = await Promise.all([
        loadNetWorth(user.id), loadCashFlow(user.id), loadTrading(user.id),
      ])
      setActivity(
        [...nwActivity, ...cfActivity, ...trActivity]
          .sort((a, b) => b.date.getTime() - a.date.getTime())
          .slice(0, 8)
      )
      setLoading(false)
    }
    init()
  }, [])

  const loadNetWorth = async (userId: string): Promise<ActivityItem[]> => {
    const [{ data: accts }, { data: bals }] = await Promise.all([
      supabase.from('financial_accounts').select('*').eq('user_id', userId),
      supabase.from('account_balances').select('account_id, as_of, balance').eq('user_id', userId).order('as_of', { ascending: true }),
    ])
    const accounts = (accts ?? []) as FinancialAccount[]
    const balances = (bals ?? []) as AccountBalance[]
    const curve = netWorthCurve(accounts, balances)
    if (curve.length > 0) {
      const current = curve[curve.length - 1].net
      const delta = curve.length > 1 ? current - curve[curve.length - 2].net : null
      setNetWorth({ current, delta })
    }
    // Show the change since the prior snapshot, not the raw net-worth value —
    // "+$154,863" next to "snapshot" would misleadingly read as a gain.
    return curve.slice(-2).map(d => {
      const idx = curve.findIndex(c => c.date === d.date)
      const prevPoint = idx > 0 ? curve[idx - 1] : null
      const delta = prevPoint ? d.net - prevPoint.net : d.net
      return {
        date: new Date(d.date + 'T12:00:00'),
        label: 'Net worth snapshot',
        sub: 'Net Worth',
        amount: delta,
        color: 'var(--blue)',
      }
    }).reverse()
  }

  const loadCashFlow = async (userId: string): Promise<ActivityItem[]> => {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    const all = (data ?? []) as Transaction[]
    setHasCashFlowData(all.length > 0)

    const { start, end } = getPresetRange('month')
    const thisMonth = all.filter(t => {
      const d = new Date(t.date + 'T12:00:00')
      return d >= start && d <= end
    })
    setCashFlowMonth(cashFlowTotals(thisMonth))

    return all.slice(0, 5).map(t => ({
      date: new Date(t.date + 'T12:00:00'),
      label: t.description || t.category || (t.type === 'income' ? 'Income' : 'Expense'),
      sub: 'Cash Flow',
      amount: t.type === 'income' ? t.amount : -t.amount,
      color: t.type === 'income' ? 'var(--green)' : 'var(--red)',
    }))
  }

  const loadTrading = async (userId: string): Promise<ActivityItem[]> => {
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
    setTradingStats(calcStats(trades))

    return [...trades]
      .sort((a, b) => b.closeTime.getTime() - a.closeTime.getTime())
      .slice(0, 5)
      .map(t => ({
        date: t.closeTime,
        label: t.symbol,
        sub: 'Trading',
        amount: t.pnl,
        color: t.pnl >= 0 ? 'var(--green)' : 'var(--red)',
      }))
  }

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

  const hasTradingData = !!tradingStats && tradingStats.tradeCount > 0

  return (
    <>
      <SectionNav />
      <div className="container">
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 24 }}>Overview</h1>

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
                      {netWorth.delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(netWorth.delta))} since last snapshot
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
              <div className="panel-title">Cash Flow (This Month)</div>
              {hasCashFlowData && cashFlowMonth ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: cashFlowMonth.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmt(cashFlowMonth.net)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Income <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(cashFlowMonth.income)}</span></span>
                    <span style={{ color: 'var(--text-muted)' }}>Expenses <span style={{ color: 'var(--red)', fontWeight: 600 }}>{fmt(cashFlowMonth.expense)}</span></span>
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
              <div className="panel-title">Trading (All Time)</div>
              {hasTradingData && tradingStats ? (
                <>
                  <div style={{ fontSize: 28, fontWeight: 800, color: tradingStats.netPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {fmt(tradingStats.netPnl)}
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{tradingStats.tradeCount} trades</span>
                    <span style={{ color: tradingStats.winRate >= 0.5 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{pct(tradingStats.winRate)} win rate</span>
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
          <div className="panel-title">Recent Activity</div>
          {activity.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
              Nothing yet — add a trade, a transaction, or a net worth snapshot to see it here.
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
