import { TxType, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/lib/cashflow'

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

// A learned rule, either built-in or saved by the user via "remember this
// categorization" in the import review screen (stored in category_rules).
export interface CategoryRule {
  pattern: RegExp
  type: TxType
  category: string
  recurring: boolean
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

// Built-in keyword rules. Matched against the CLEANED description (same text
// shown in the review screen), not the raw bank line, so these compose with
// user-saved rules against one consistent text.
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
  { pattern: /MORTGAGE|\bRENT PAYMENT\b/i, category: 'Housing', recurring: true },
  { pattern: /STATE FARM|GEICO|PROGRESSIVE|ALLSTATE|INSURANCE/i, category: 'Insurance', recurring: true },
  { pattern: /QUESTAR|DOMINION ENERGY|ROCKY MOUNTAIN POWER|UTILIT|ELECTRIC|WATER (DEPT|CO)|GAS CO/i, category: 'Utilities', recurring: true },
  { pattern: /VERIZON|AT&T|T-MOBILE|COMCAST|XFINITY|CENTURYLINK/i, category: 'Utilities', recurring: true },
  { pattern: /NETFLIX|HULU|SPOTIFY|DISNEY\+|APPLE\.COM\/BILL|\bSUBSCRIPTION\b/i, category: 'Subscriptions', recurring: true },
  { pattern: /PLANET FITNESS|ANYTIME FITNESS|VASA FIT|LA FITNESS/i, category: 'Subscriptions', recurring: true },
  { pattern: /MONTHLY (FEE|MAINTENANCE)|SERVICE CHARGE|ACCOUNT FEE/i, category: 'Other', recurring: true },
  // Everyday spend
  // Negative lookahead avoids "MOSLEY MARKETING INC" (a business-account
  // transfer) false-matching as a grocery "MARKET"
  { pattern: /MARKET(?!ING)|GROCERY|WALMART|SMITH'?S/i, category: 'Groceries' },
  { pattern: /DINER|RESTAURANT|GRILL|CAFE|PIZZA|MCDONALD|WENDY|CHICK-FIL-A|CHIPOTLE|STARBUCKS|DUTCH BROS|BURGER KING|TACO BELL|IN-N-OUT|SUBWAY|\bKFC\b|SONIC DRIVE/i, category: 'Dining' },
  { pattern: /WALGREENS|CVS|RITE AID/i, category: 'Shopping' },
  { pattern: /AMAZON|\bTARGET\b|BEST BUY/i, category: 'Shopping' },
  { pattern: /HOME DEPOT|LOWE'?S/i, category: 'Housing' },
  { pattern: /LIQUOR/i, category: 'Entertainment' },
  { pattern: /VAPE|SMOKE SHOP/i, category: 'Shopping' },
  { pattern: /\bUBER\b|\bLYFT\b|PARKING|\bTOLL\b/i, category: 'Transportation' },
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
// customRules (learned from "remember this categorization" in the review
// screen) are checked before the built-in keyword rules, so a user
// correction always wins on the next import. Anything nothing recognizes
// defaults to category 'Other' and is flagged needsReview so it's visible —
// never silently miscategorized.
export function parseBankStatement(csvText: string, customRules: CategoryRule[] = []): ParsedBankTransaction[] {
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
    const cleaned = cleanDescription(desc)
    const categoryPool = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES

    const exclusion = EXCLUDE_PATTERNS.find(p => p.pattern.test(cleaned))
    const customMatch = customRules.find(r => r.type === type && r.pattern.test(cleaned))
    const builtInMatch = CATEGORY_RULES.find(r => r.pattern.test(cleaned) && (categoryPool as string[]).includes(r.category))
    const matched = customMatch ?? (builtInMatch ? { category: builtInMatch.category, recurring: builtInMatch.recurring ?? false } : null)

    const isCheck = /^CHECK\s+\d/i.test(cleaned)
    const isZelle = /ZELLE/i.test(cleaned)
    const unmatchedLarge = !matched && amount > 500

    rows.push({
      date,
      amount,
      type,
      category: matched ? matched.category : 'Other',
      description: cleaned,
      recurring: matched?.recurring ?? false,
      excluded: !!exclusion,
      excludeReason: exclusion ? exclusion.reason : null,
      needsReview: !exclusion && (isCheck || isZelle || unmatchedLarge || !matched),
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Turns a saved category_rules row into a matchable rule.
export function toCategoryRule(row: { pattern: string; type: TxType; category: string; recurring: boolean }): CategoryRule {
  return { pattern: new RegExp(escapeRegExp(row.pattern), 'i'), type: row.type, category: row.category, recurring: row.recurring }
}

// Suggests a stable keyword to "remember" a merchant by — stops at the
// first store number ("#7052"), bare reference number, or after 2 words,
// since store city/state usually trails the merchant name in this format.
// For "Venmo - Name" / "Zelle - Name" (cleanDescription's person-to-person
// format), uses just the name — that substring still matches whichever
// channel (Venmo, Zelle, etc.) carries the same payment next time, whereas
// keeping the "Venmo -" prefix would only match Venmo specifically and
// literally wouldn't match itself since the split cuts at the dash.
// Always shown as an editable field in the UI; this is a starting guess,
// not a guarantee.
export function deriveRulePattern(description: string): string {
  const dashSplit = description.split(' - ')
  const base = dashSplit.length > 1 ? dashSplit[1] : description
  const words = base.split(/\s+/)
  const core: string[] = []
  for (const w of words) {
    if (/^\d+$/.test(w) || /^#\d+/.test(w)) break
    core.push(w)
    if (core.length >= 2) break
  }
  return core.join(' ') || base
}
