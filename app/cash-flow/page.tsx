'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import SectionNav from '@/components/SectionNav'
import CashFlowChart from '@/components/CashFlowChart'
import { Field, inputStyle } from '@/components/FormField'
import { Preset, PRESETS, getPresetRange, todayStr } from '@/lib/dateRange'
import {
  Transaction,
  TxType,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  totals,
  monthlyCashFlow,
  categoryBreakdown,
} from '@/lib/cashflow'

const fmt = (n: number) =>
  n >= 0
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const pct = (n: number) => `${(n * 100).toFixed(1)}%`

export default function CashFlowPage() {
  const router = useRouter()
  const supabase = createClient()

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)

  const [preset, setPreset] = useState<Preset>('month')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const [adding, setAdding] = useState(false)
  const [formType, setFormType] = useState<TxType>('expense')
  const [formDate, setFormDate] = useState(todayStr())
  const [formCategory, setFormCategory] = useState(EXPENSE_CATEGORIES[0])
  const [formAmount, setFormAmount] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formRecurring, setFormRecurring] = useState(false)

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      await loadTransactions(user.id)
      setLoadingData(false)
    }
    init()
  }, [])

  const loadTransactions = async (userId: string) => {
    const { data } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
    setTransactions((data ?? []) as Transaction[])
  }

  const hasData = transactions.length > 0

  const filtered = useMemo(() => {
    if (transactions.length === 0) return []
    let start: Date, end: Date
    if (preset === 'custom') {
      start = customStart ? new Date(customStart + 'T00:00:00') : new Date(0)
      end = customEnd ? new Date(customEnd + 'T23:59:59') : new Date()
    } else {
      ({ start, end } = getPresetRange(preset))
    }
    return transactions.filter(t => {
      const d = new Date(t.date + 'T12:00:00')
      return d >= start && d <= end
    })
  }, [transactions, preset, customStart, customEnd])

  const periodTotals = useMemo(() => totals(filtered), [filtered])
  const recurringExpenses = useMemo(
    () => filtered.filter(t => t.type === 'expense' && t.recurring).reduce((s, t) => s + t.amount, 0),
    [filtered]
  )
  const trend = useMemo(() => monthlyCashFlow(transactions), [transactions])
  const expenseBreakdown = useMemo(() => categoryBreakdown(filtered, 'expense'), [filtered])
  const incomeBreakdown = useMemo(() => categoryBreakdown(filtered, 'income'), [filtered])

  const onTypeChange = (t: TxType) => {
    setFormType(t)
    setFormCategory(t === 'expense' ? EXPENSE_CATEGORIES[0] : INCOME_CATEGORIES[0])
  }

  const addTransaction = async () => {
    const amount = parseFloat(formAmount)
    if (!formDate || isNaN(amount) || amount <= 0) return
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const { error } = await supabase.from('transactions').insert({
      user_id: user.id,
      date: formDate,
      amount,
      category: formCategory,
      description: formDescription.trim() || null,
      type: formType,
      recurring: formRecurring,
    })
    if (error) { alert(`Failed to add transaction: ${error.message}`); setSaving(false); return }
    await loadTransactions(user.id)
    setSaving(false)
    setFormAmount('')
    setFormDescription('')
    setFormRecurring(false)
  }

  const deleteTransaction = async (id: string) => {
    if (!confirm('Delete this transaction?')) return
    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) { alert(`Failed to delete: ${error.message}`); return }
    setTransactions(prev => prev.filter(t => t.id !== id))
  }

  if (loadingData) {
    return (
      <>
        <SectionNav />
        <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          Loading...
        </div>
      </>
    )
  }

  return (
    <>
      <SectionNav />
      <div className="container">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Cash Flow</h1>
          <button
            onClick={() => setAdding(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
              background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff',
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>{adding ? '×' : '+'}</span> {adding ? 'Close' : 'Add Transaction'}
          </button>
        </div>

        {/* ── Add transaction form ── */}
        {adding && (
          <div className="panel" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <Field label="Type">
                <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
                  {(['expense', 'income'] as TxType[]).map(t => (
                    <button
                      key={t}
                      onClick={() => onTypeChange(t)}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                        textTransform: 'capitalize',
                        background: formType === t ? (t === 'income' ? 'var(--green)' : 'var(--red)') : 'transparent',
                        color: formType === t ? '#fff' : 'var(--text-muted)',
                      }}
                    >{t}</button>
                  ))}
                </div>
              </Field>
              <Field label="Date">
                <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} style={inputStyle(140)} />
              </Field>
              <Field label="Category">
                <select value={formCategory} onChange={e => setFormCategory(e.target.value)} style={inputStyle(150)}>
                  {(formType === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Amount">
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                  <input
                    type="number"
                    value={formAmount}
                    onChange={e => setFormAmount(e.target.value)}
                    placeholder="0.00"
                    style={inputStyle(110)}
                  />
                </div>
              </Field>
              <Field label="Description (optional)">
                <input
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addTransaction() }}
                  placeholder="e.g. Costco run"
                  style={inputStyle(180)}
                />
              </Field>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', paddingBottom: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={formRecurring} onChange={e => setFormRecurring(e.target.checked)} />
                Recurring
              </label>
              <button
                onClick={addTransaction}
                disabled={saving}
                style={{ padding: '9px 16px', background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
              >
                {saving ? 'Saving...' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {!hasData ? (
          <div className="empty-state">
            <h2>Track your cash flow</h2>
            <p>Log income and expenses to see monthly trends and where your money goes.</p>
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                style={{ marginTop: 16, padding: '10px 20px', background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                + Add your first transaction
              </button>
            )}
          </div>
        ) : (
          <>
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

            {filtered.length === 0 ? (
              <div className="empty-state">
                <h2>No transactions in this period</h2>
                <p>Try a different date range</p>
              </div>
            ) : (
              <>
                {/* ── Hero: Net cash flow + monthly trend ── */}
                <div className="panel" style={{ marginBottom: 24, display: 'flex', alignItems: 'stretch', gap: 0, padding: 0, overflow: 'hidden' }}>
                  <div style={{ width: 230, flexShrink: 0, padding: 24, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                      Net Cash Flow
                    </div>
                    <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: periodTotals.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                      {fmt(periodTotals.net)}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Income</span>
                        <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(periodTotals.income)}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: 'var(--text-muted)' }}>Expenses</span>
                        <span style={{ color: 'var(--red)', fontWeight: 600 }}>-{fmt(periodTotals.expense)}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: '16px 20px 12px 20px' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 8 }}>
                      Monthly Trend
                    </div>
                    <CashFlowChart data={trend} />
                  </div>
                </div>

                {/* ── KPI cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
                  <div className="stat-card">
                    <div className="stat-label">Income</div>
                    <div className="stat-value green">{fmt(periodTotals.income)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Expenses</div>
                    <div className="stat-value red">{fmt(periodTotals.expense)}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Savings Rate</div>
                    <div className={`stat-value ${periodTotals.savingsRate !== null && periodTotals.savingsRate >= 0 ? 'green' : 'red'}`}>
                      {periodTotals.savingsRate !== null ? pct(periodTotals.savingsRate) : '—'}
                    </div>
                    <div className="stat-sub">{periodTotals.savingsRate === null ? 'No income this period' : periodTotals.savingsRate >= 0.2 ? 'Strong' : periodTotals.savingsRate >= 0 ? 'Positive' : 'Spending more than earning'}</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Recurring Expenses</div>
                    <div className="stat-value red">{fmt(recurringExpenses)}</div>
                    <div className="stat-sub">this period</div>
                  </div>
                </div>

                {/* ── Category breakdown ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                  <CategoryColumn title="Expense Categories" accent="var(--red)" rows={expenseBreakdown} />
                  <CategoryColumn title="Income Sources" accent="var(--green)" rows={incomeBreakdown} />
                </div>

                {/* ── Transaction log ── */}
                <div className="panel">
                  <div className="panel-title">Transactions</div>
                  <table className="trade-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Category</th>
                        <th>Description</th>
                        <th>Amount</th>
                        <th style={{ width: 32 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .slice()
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map(t => (
                          <tr key={t.id}>
                            <td style={{ color: 'var(--text-muted)' }}>{new Date(t.date + 'T12:00:00').toLocaleDateString()}</td>
                            <td className={t.type === 'income' ? 'badge-win' : 'badge-loss'}>{t.type === 'income' ? 'Income' : 'Expense'}</td>
                            <td>
                              {t.category}
                              {t.recurring && <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>↻ recurring</span>}
                            </td>
                            <td style={{ color: 'var(--text-muted)' }}>{t.description || '—'}</td>
                            <td className={t.type === 'income' ? 'badge-win' : 'badge-loss'}>{t.type === 'income' ? '+' : '-'}{fmt(t.amount)}</td>
                            <td>
                              <button
                                onClick={() => deleteTransaction(t.id)}
                                title="Delete"
                                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
                              >✕</button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  )
}

function CategoryColumn({
  title, accent, rows,
}: {
  title: string
  accent: string
  rows: { category: string; amount: number; count: number }[]
}) {
  const max = Math.max(...rows.map(r => r.amount), 1)
  return (
    <div className="panel">
      <div className="panel-title">{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>None in this period.</div>
      ) : (
        <div className="subtle-scroll" style={{ maxHeight: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(r => (
            <div key={r.category} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 100, fontSize: 12, color: 'var(--text)', fontWeight: 500, flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.category}
              </div>
              <div style={{ flex: 1, height: 8, background: 'var(--surface2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 4, width: `${(r.amount / max) * 100}%`, background: accent }} />
              </div>
              <div style={{ width: 76, fontSize: 12, textAlign: 'right', color: accent, fontWeight: 600 }}>
                {fmt(r.amount)}
              </div>
              <div style={{ width: 24, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                {r.count}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
