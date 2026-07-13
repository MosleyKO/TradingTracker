export type AccountKind = 'asset' | 'liability'

export interface FinancialAccount {
  id: string
  name: string
  kind: AccountKind
  category: string | null
  display_order: number
  is_active: boolean
}

export interface AccountBalance {
  account_id: string
  as_of: string // 'YYYY-MM-DD'
  balance: number
}

// Categories that default to a liability when adding an account
export const LIABILITY_CATEGORIES = ['Credit Card', 'Loan', 'Mortgage', 'Line of Credit']

export const ACCOUNT_CATEGORIES = [
  'Checking',
  'Savings',
  'Investment',
  'Retirement',
  'Cash',
  'Property',
  'Vehicle',
  'Business',
  'Credit Card',
  'Loan',
  'Mortgage',
  'Other',
]

// Net worth over time: sum(assets) − sum(liabilities) grouped by snapshot date.
// Uses ALL accounts (incl. archived) so historical points stay correct.
export function netWorthCurve(
  accounts: FinancialAccount[],
  balances: AccountBalance[]
): { date: string; net: number }[] {
  const kindById = new Map(accounts.map(a => [a.id, a.kind]))
  const byDate = new Map<string, number>()
  for (const b of balances) {
    const sign = kindById.get(b.account_id) === 'liability' ? -1 : 1
    byDate.set(b.as_of, (byDate.get(b.as_of) ?? 0) + sign * b.balance)
  }
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, net]) => ({ date, net }))
}

// Most recent balance recorded for each account (by date).
export function latestBalanceByAccount(
  balances: AccountBalance[]
): Map<string, { balance: number; as_of: string }> {
  const m = new Map<string, { balance: number; as_of: string }>()
  for (const b of balances) {
    const cur = m.get(b.account_id)
    if (!cur || b.as_of > cur.as_of) m.set(b.account_id, { balance: b.balance, as_of: b.as_of })
  }
  return m
}

// All distinct snapshot dates, newest first.
export function snapshotDates(balances: AccountBalance[]): string[] {
  const set = new Set(balances.map(b => b.as_of))
  return Array.from(set).sort((a, b) => b.localeCompare(a))
}
