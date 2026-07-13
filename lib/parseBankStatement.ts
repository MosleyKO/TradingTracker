import { TxType } from '@/lib/cashflow'

export interface ParsedBankTransaction {
  date: string // 'YYYY-MM-DD'
  amount: number
  type: TxType
  category: string
  description: string
  recurring: boolean
  excluded: boolean
  excludeReason: string | null
  needsReview: boolean
}

// Transactions that just move money between Koby's own tracked accounts —
// never income or spending, would inflate both sides of Cash Flow. Standing
// policy confirmed 2026-07-13.
const EXCLUDE_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /TRANSFER TO SHARE ACCOUNT/i, reason: 'Transfer to your own account' },
  { pattern: /TRANSFER TO SAVINGS/i, reason: 'Transfer to your own account' },
  { pattern: /PEER TO PEER TRANSFER.*WEBULL/i, reason: 'Transfer from your own Webull account' },
  { pattern: /VENMO CASHOUT/i, reason: 'Transfer from your own Venmo balance' },
]

const CATEGORY_RULES: { pattern: RegExp; category: string; recurring?: boolean }[] = [
  // Income
  { pattern: /PAYROLL/i, category: 'Salary', recurring: true },
  { pattern: /STRIPE/i, category: 'Business Income', recurring: true },
  { pattern: /DIVIDEND/i, category: 'Interest', recurring: true },
  { pattern: /INTEREST (EARNED|PAID)/i, category: 'Interest', recurring: true },
  // Debt / recurring bills
  { pattern: /STUDENT (LN|LOAN)|DEPT EDUCATION|SALLIE MAE|NAVIENT/i, category: 'Debt Payment', recurring: true },
  { pattern: /DISCOVER E-?PAYMENT|CREDIT CARD PAYMENT|CAPITAL ?ONE|CHASE CARD|AMEX PAYMENT/i, category: 'Debt Payment', recurring: true },
  { pattern: /TRANSFER TO LOAN|LOAN PAYMENT|AUTO LOAN/i, category: 'Debt Payment', recurring: true },
  { pattern: /MORTGAGE/i, category: 'Housing', recurring: true },
  { pattern: /STATE FARM|GEICO|PROGRESSIVE|ALLSTATE|INSURANCE/i, category: 'Insurance', recurring: true },
  { pattern: /QUESTAR|DOMINION ENERGY|ROCKY MOUNTAIN POWER|UTILIT|ELECTRIC|WATER (DEPT|CO)|GAS CO/i, category: 'Utilities', recurring: true },
  { pattern: /NETFLIX|HULU|SPOTIFY|DISNEY\+|APPLE\.COM\/BILL|SUBSCRIPTION/i, category: 'Subscriptions', recurring: true },
  { pattern: /MONTHLY (FEE|MAINTENANCE)|SERVICE CHARGE|ACCOUNT FEE/i, category: 'Other', recurring: true },
  // Everyday spend
  // Negative lookahead avoids "MOSLEY MARKETING INC" (a business-account
  // transfer) false-matching as a grocery "MARKET"
  { pattern: /MARKET(?!ING)|GROCERY|WALMART|SMITH'?S/i, category: 'Groceries' },
  { pattern: /DINER|RESTAURANT|GRILL|CAFE|PIZZA|MCDONALD|WENDY|CHICK-FIL-A|CHIPOTLE/i, category: 'Dining' },
  { pattern: /WALGREENS|CVS|RITE AID/i, category: 'Shopping' },
  { pattern: /LIQUOR/i, category: 'Entertainment' },
  { pattern: /VAPE|SMOKE SHOP/i, category: 'Shopping' },
  // Koby-specific recurring payments (personal single-user app, safe to hardcode)
  { pattern: /ZELLE.*DALTON TAYLOR/i, category: 'Housing', recurring: true },
  { pattern: /ACCEPTVA/i, category: 'Subscriptions', recurring: true },
]

function parseCSVLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQuotes = false
      } else cur += ch
    } else {
      if (ch === '"') inQuotes = true
      else if (ch === ',') { cells.push(cur); cur = '' }
      else cur += ch
    }
  }
  cells.push(cur)
  return cells
}

function normalizeDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, mo, d, y] = m
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function cleanDescription(raw: string): string {
  const s = raw.trim()

  const zelle = s.match(/ZELLE\s+([A-Za-z][A-Za-z ]*)/i)
  if (zelle) return `Zelle - ${titleCase(zelle[1].trim())}`

  const venmo = s.match(/VENMO \*([A-Za-z][A-Za-z ]*)/i)
  if (venmo) return `Venmo - ${titleCase(venmo[1].trim())}`

  const visa = s.match(/^VISA - \d{2}\/\d{2}\s+(.+)$/i)
  if (visa) return titleCase(visa[1].trim())

  let cleaned = s.replace(/^(AUTOMATIC (DEPOSIT|WITHDRAWAL)),?\s*/i, '')
  cleaned = cleaned.replace(/\s+(PPD|CCD|WEB\s*\(S\)|WEB|TEL)$/i, '')
  return titleCase(cleaned)
}

// Parses this credit union's "Date,No.,Description,Debit,Credit" export format.
// Anything the rules don't recognize defaults to category 'Other' and is
// flagged needsReview so it's visible in the import review screen — never
// silently miscategorized.
export function parseBankStatement(csvText: string): ParsedBankTransaction[] {
  const lines = csvText.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return []

  const rows: ParsedBankTransaction[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i])
    if (cols.length < 5) continue
    const dateRaw = cols[0]
    const descRaw = cols[2]
    const debitRaw = cols[3]
    const creditRaw = cols[4]
    if (!dateRaw?.trim()) continue

    const debit = parseFloat(debitRaw)
    const credit = parseFloat(creditRaw)
    let type: TxType, amount: number
    if (!isNaN(debit) && debit !== 0) { type = 'expense'; amount = Math.abs(debit) }
    else if (!isNaN(credit) && credit !== 0) { type = 'income'; amount = credit }
    else continue

    const date = normalizeDate(dateRaw.trim())
    if (!date) continue

    const desc = descRaw.trim()
    const exclusion = EXCLUDE_PATTERNS.find(p => p.pattern.test(desc))
    const rule = CATEGORY_RULES.find(r => r.pattern.test(desc))
    const isCheck = /^CHECK\s+\d/i.test(desc)
    const isZelle = /ZELLE/i.test(desc)
    const unmatchedLarge = !rule && amount > 500

    rows.push({
      date,
      amount,
      type,
      category: rule ? rule.category : 'Other',
      description: cleanDescription(desc),
      recurring: rule?.recurring ?? false,
      excluded: !!exclusion,
      excludeReason: exclusion ? exclusion.reason : null,
      needsReview: !exclusion && (isCheck || isZelle || unmatchedLarge || !rule),
    })
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

// Dedupe key for skipping re-imports of overlapping statement periods.
// Intentionally ignores description — hand-edited descriptions from a
// prior import (or a re-run of the auto-cleaner producing a slightly
// different string) shouldn't cause a real duplicate to slip through.
export function bankTxKey(t: { date: string; amount: number; type: TxType }): string {
  return `${t.date}|${t.amount.toFixed(2)}|${t.type}`
}
