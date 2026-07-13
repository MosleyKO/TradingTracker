export type TxType = 'income' | 'expense'

export interface Transaction {
  id: string
  date: string // 'YYYY-MM-DD'
  amount: number
  category: string | null
  description: string | null
  type: TxType
  recurring: boolean
}

export const EXPENSE_CATEGORIES = [
  'Housing', 'Utilities', 'Groceries', 'Dining', 'Transportation', 'Insurance',
  'Healthcare', 'Entertainment', 'Subscriptions', 'Shopping', 'Debt Payment',
  'Business', 'Travel', 'Other',
]

export const INCOME_CATEGORIES = [
  'Salary', 'Business Income', 'Trading Income', 'Side Income', 'Asset Sale', 'Interest', 'Gift', 'Other',
]

export function totals(transactions: Transaction[]) {
  let income = 0, expense = 0
  for (const t of transactions) {
    if (t.type === 'income') income += t.amount
    else expense += t.amount
  }
  const net = income - expense
  return { income, expense, net, savingsRate: income > 0 ? net / income : null }
}

// Monthly income/expense/net, from ALL transactions (independent of any period filter) —
// mirrors the trading page's calendar, which always shows the full history.
export function monthlyCashFlow(
  transactions: Transaction[]
): { month: string; income: number; expense: number; net: number }[] {
  const map = new Map<string, { income: number; expense: number }>()
  for (const t of transactions) {
    const month = t.date.slice(0, 7)
    const e = map.get(month) || { income: 0, expense: 0 }
    if (t.type === 'income') e.income += t.amount
    else e.expense += t.amount
    map.set(month, e)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, income: v.income, expense: v.expense, net: v.income - v.expense }))
}

export function categoryBreakdown(
  transactions: Transaction[],
  type: TxType
): { category: string; amount: number; count: number }[] {
  const map = new Map<string, { amount: number; count: number }>()
  for (const t of transactions) {
    if (t.type !== type) continue
    const cat = t.category || 'Uncategorized'
    const e = map.get(cat) || { amount: 0, count: 0 }
    e.amount += t.amount
    e.count += 1
    map.set(cat, e)
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.amount - a.amount)
}
