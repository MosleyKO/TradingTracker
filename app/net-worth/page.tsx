'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import SectionNav from '@/components/SectionNav'
import NetWorthChart from '@/components/NetWorthChart'
import {
  FinancialAccount,
  AccountBalance,
  AccountKind,
  ACCOUNT_CATEGORIES,
  LIABILITY_CATEGORIES,
  netWorthCurve,
  latestBalanceByAccount,
} from '@/lib/networth'

const todayStr = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const fmt = (n: number) =>
  n >= 0
    ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `-$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function NetWorthPage() {
  const router = useRouter()
  const supabase = createClient()

  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [balances, setBalances] = useState<AccountBalance[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [saving, setSaving] = useState(false)

  // Add-account form
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('Checking')
  const [newKind, setNewKind] = useState<AccountKind>('asset')

  // Snapshot editor
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorDate, setEditorDate] = useState(todayStr())
  const [editorValues, setEditorValues] = useState<Record<string, string>>({})
  const [tradingEstimates, setTradingEstimates] = useState<Record<string, number>>({})

  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth'); return }
      await loadData(user.id)
      setLoadingData(false)
    }
    init()
  }, [])

  const loadData = async (userId: string) => {
    const [{ data: accts }, { data: bals }] = await Promise.all([
      supabase.from('financial_accounts').select('*').eq('user_id', userId).order('display_order', { ascending: true }),
      supabase.from('account_balances').select('account_id, as_of, balance').eq('user_id', userId).order('as_of', { ascending: true }),
    ])
    setAccounts((accts ?? []) as FinancialAccount[])
    setBalances((bals ?? []) as AccountBalance[])
    await loadTradingEstimates(userId)
  }

  // Trading accounts (Webull/Swings/Day Trades) are also net-worth accounts here —
  // pull a live starting-balance + realized-P&L estimate as a reference hint in the
  // snapshot editor. Never auto-fills over a real entry; the broker balance is truth.
  const loadTradingEstimates = async (userId: string) => {
    const [{ data: tAccounts }, { data: tTrades }] = await Promise.all([
      supabase.from('accounts').select('id, name, starting_balance').eq('user_id', userId),
      supabase.from('trades').select('account_type, pnl').eq('user_id', userId),
    ])
    const pnlByAccountId = new Map<string, number>()
    for (const t of (tTrades ?? []) as any[]) {
      pnlByAccountId.set(t.account_type, (pnlByAccountId.get(t.account_type) ?? 0) + t.pnl)
    }
    const estimates: Record<string, number> = {}
    for (const a of (tAccounts ?? []) as any[]) {
      estimates[a.name] = (a.starting_balance ?? 0) + (pnlByAccountId.get(a.id) ?? 0)
    }
    setTradingEstimates(estimates)
  }

  const activeAccounts = useMemo(() => accounts.filter(a => a.is_active), [accounts])
  const assets = useMemo(() => activeAccounts.filter(a => a.kind === 'asset'), [activeAccounts])
  const liabilities = useMemo(() => activeAccounts.filter(a => a.kind === 'liability'), [activeAccounts])

  const latest = useMemo(() => latestBalanceByAccount(balances), [balances])
  const curve = useMemo(() => netWorthCurve(accounts, balances), [accounts, balances])

  const totalAssets = useMemo(
    () => assets.reduce((s, a) => s + (latest.get(a.id)?.balance ?? 0), 0),
    [assets, latest]
  )
  const totalLiabilities = useMemo(
    () => liabilities.reduce((s, a) => s + (latest.get(a.id)?.balance ?? 0), 0),
    [liabilities, latest]
  )
  const currentNet = totalAssets - totalLiabilities
  const prevSnapshotNet = curve.length > 1 ? curve[curve.length - 2].net : null
  const delta = prevSnapshotNet !== null ? currentNet - prevSnapshotNet : null

  const hasAccounts = accounts.length > 0
  const hasBalances = balances.length > 0

  // ── Actions ──
  const onCategoryChange = (cat: string) => {
    setNewCategory(cat)
    setNewKind(LIABILITY_CATEGORIES.includes(cat) ? 'liability' : 'asset')
  }

  const addAccount = async () => {
    const name = newName.trim()
    if (!name) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const acct = {
      id: crypto.randomUUID(),
      user_id: user.id,
      name,
      kind: newKind,
      category: newCategory,
      display_order: accounts.length,
      is_active: true,
    }
    const { error } = await supabase.from('financial_accounts').insert(acct)
    if (error) { alert(`Failed to add account: ${error.message}`); return }
    const { user_id, ...row } = acct
    setAccounts(prev => [...prev, row as FinancialAccount])
    setAdding(false)
    setNewName('')
    setNewCategory('Checking')
    setNewKind('asset')
  }

  const archiveAccount = async (id: string, name: string) => {
    if (!confirm(`Archive "${name}"? Its history stays in your net-worth trend, but it won't appear in new snapshots.`)) return
    const { error } = await supabase.from('financial_accounts').update({ is_active: false }).eq('id', id)
    if (error) { alert(`Failed to archive: ${error.message}`); return }
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, is_active: false } : a))
  }

  const openEditor = () => {
    const vals: Record<string, string> = {}
    for (const a of activeAccounts) {
      const b = latest.get(a.id)
      const estimate = tradingEstimates[a.name]
      vals[a.id] = b ? String(b.balance) : estimate !== undefined ? String(Math.round(estimate)) : ''
    }
    setEditorValues(vals)
    setEditorDate(todayStr())
    setEditorOpen(true)
  }

  const saveSnapshot = async () => {
    setSaving(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }
    const rows = activeAccounts.map(a => ({
      user_id: user.id,
      account_id: a.id,
      as_of: editorDate,
      balance: parseFloat(editorValues[a.id]) || 0,
    }))
    const { error } = await supabase
      .from('account_balances')
      .upsert(rows, { onConflict: 'account_id,as_of' })
    if (error) { alert(`Failed to save snapshot: ${error.message}`); setSaving(false); return }
    await loadData(user.id)
    setSaving(false)
    setEditorOpen(false)
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

  const editorTotal = activeAccounts.reduce((s, a) => {
    const v = parseFloat(editorValues[a.id]) || 0
    return s + (a.kind === 'liability' ? -v : v)
  }, 0)

  return (
    <>
      <SectionNav />
      <div className="container">
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Net Worth</h1>
          {hasAccounts && (
            <button
              onClick={openEditor}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
                background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff',
                cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Update Balances
            </button>
          )}
        </div>

        {!hasAccounts ? (
          <div className="empty-state">
            <h2>Track your net worth</h2>
            <p>Add your accounts — checking, savings, investments, credit cards, loans — then take a snapshot to start your trend.</p>
            <button
              onClick={() => setAdding(true)}
              style={{ marginTop: 16, padding: '10px 20px', background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
            >
              + Add your first account
            </button>
          </div>
        ) : (
          <>
            {/* ── Hero: current net worth + curve ── */}
            <div className="panel" style={{ marginBottom: 24, display: 'flex', alignItems: 'stretch', gap: 0, padding: 0, overflow: 'hidden' }}>
              <div style={{ width: 250, flexShrink: 0, padding: 24, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>
                  Current Net Worth
                </div>
                <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: currentNet >= 0 ? 'var(--text)' : 'var(--red)' }}>
                  {fmt(currentNet)}
                </div>
                {delta !== null && (
                  <div style={{ fontSize: 13, fontWeight: 600, color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {delta >= 0 ? '▲' : '▼'} {fmt(Math.abs(delta))} since last snapshot
                  </div>
                )}
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Assets</span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>{fmt(totalAssets)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>Liabilities</span>
                    <span style={{ color: 'var(--red)', fontWeight: 600 }}>-{fmt(totalLiabilities)}</span>
                  </div>
                </div>
              </div>
              <div style={{ flex: 1, padding: '16px 20px 12px 20px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 8 }}>
                  Net Worth Over Time
                </div>
                {hasBalances ? (
                  <NetWorthChart data={curve} />
                ) : (
                  <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                    Take a snapshot to start your trend →
                  </div>
                )}
              </div>
            </div>

            {/* ── Breakdown: Assets + Liabilities ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
              <AccountColumn
                title="Assets"
                accent="var(--green)"
                accountsList={assets}
                latest={latest}
                total={totalAssets}
                onArchive={archiveAccount}
              />
              <AccountColumn
                title="Liabilities"
                accent="var(--red)"
                accountsList={liabilities}
                latest={latest}
                total={totalLiabilities}
                negative
                onArchive={archiveAccount}
              />
            </div>
          </>
        )}

        {/* ── Add account form ── */}
        {(adding || hasAccounts) && (
          <div className="panel" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: adding ? 16 : 0 }}>
              <div className="panel-title" style={{ marginBottom: 0 }}>Accounts</div>
              {!adding && (
                <button
                  onClick={() => setAdding(true)}
                  style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', cursor: 'pointer', padding: '5px 12px', fontSize: 12 }}
                >
                  + Add account
                </button>
              )}
            </div>
            {adding && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <Field label="Account name">
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addAccount(); if (e.key === 'Escape') setAdding(false) }}
                    placeholder="e.g. Ally Savings"
                    autoFocus
                    style={inputStyle(180)}
                  />
                </Field>
                <Field label="Category">
                  <select value={newCategory} onChange={e => onCategoryChange(e.target.value)} style={inputStyle(150)}>
                    {ACCOUNT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Type">
                  <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', padding: 3, borderRadius: 8, border: '1px solid var(--border)' }}>
                    {(['asset', 'liability'] as AccountKind[]).map(k => (
                      <button
                        key={k}
                        onClick={() => setNewKind(k)}
                        style={{
                          padding: '5px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                          textTransform: 'capitalize',
                          background: newKind === k ? (k === 'asset' ? 'var(--green)' : 'var(--red)') : 'transparent',
                          color: newKind === k ? '#fff' : 'var(--text-muted)',
                        }}
                      >{k}</button>
                    ))}
                  </div>
                </Field>
                <button onClick={addAccount} style={{ padding: '9px 16px', background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                <button onClick={() => { setAdding(false); setNewName('') }} style={{ padding: '9px 12px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Snapshot editor overlay ── */}
      {editorOpen && (
        <div
          onClick={() => !saving && setEditorOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '6vh', zIndex: 50 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="panel"
            style={{ width: 460, maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 0 }}
          >
            <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Update Balances</div>
              <input
                type="date"
                value={editorDate}
                onChange={e => setEditorDate(e.target.value)}
                style={{ ...inputStyle(140), padding: '6px 10px' }}
              />
            </div>
            <div className="subtle-scroll" style={{ padding: '8px 20px', overflowY: 'auto', flex: 1 }}>
              {activeAccounts.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{a.name}</div>
                    <div style={{ fontSize: 11, color: a.kind === 'liability' ? 'var(--red)' : 'var(--text-muted)' }}>
                      {a.category}{a.kind === 'liability' ? ' · owed' : ''}
                    </div>
                    {tradingEstimates[a.name] !== undefined && (
                      <div style={{ fontSize: 10, color: 'var(--blue)', marginTop: 1 }}>
                        ≈ {fmt(tradingEstimates[a.name])} from trading tracker
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>$</span>
                    <input
                      type="number"
                      value={editorValues[a.id] ?? ''}
                      onChange={e => setEditorValues(prev => ({ ...prev, [a.id]: e.target.value }))}
                      placeholder="0"
                      style={{ ...inputStyle(120), textAlign: 'right' }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Net worth this date</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: editorTotal >= 0 ? 'var(--text)' : 'var(--red)' }}>{fmt(editorTotal)}</span>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={saveSnapshot}
                  disabled={saving}
                  style={{ flex: 1, padding: '10px', background: 'var(--blue)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? 'Saving...' : 'Save Snapshot'}
                </button>
                <button
                  onClick={() => setEditorOpen(false)}
                  disabled={saving}
                  style={{ padding: '10px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 14, cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Sub-components ──

function AccountColumn({
  title, accent, accountsList, latest, total, negative, onArchive,
}: {
  title: string
  accent: string
  accountsList: FinancialAccount[]
  latest: Map<string, { balance: number; as_of: string }>
  total: number
  negative?: boolean
  onArchive: (id: string, name: string) => void
}) {
  const max = Math.max(...accountsList.map(a => latest.get(a.id)?.balance ?? 0), 1)
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div className="panel-title" style={{ marginBottom: 0 }}>{title}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: accent }}>{negative ? '-' : ''}{fmtShort(total)}</div>
      </div>
      {accountsList.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>None yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {accountsList.map(a => {
            const bal = latest.get(a.id)?.balance ?? 0
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {a.name}
                      <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{a.category}</span>
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: accent, flexShrink: 0, marginLeft: 8 }}>{fmtShort(bal)}</span>
                  </div>
                  <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${(bal / max) * 100}%`, background: accent }} />
                  </div>
                </div>
                <button
                  onClick={() => onArchive(a.id, a.name)}
                  title="Archive account"
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, padding: '0 2px', flexShrink: 0 }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle = (width: number): React.CSSProperties => ({
  width,
  padding: '8px 10px',
  background: 'var(--surface2)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  color: 'var(--text)',
  fontSize: 13,
  outline: 'none',
})

const fmtShort = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
