export type Preset = 'today' | 'week' | 'month' | '3month' | 'year' | 'all' | 'custom'

export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: '3month', label: '3 Months' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom' },
]

export function getPresetRange(preset: Preset): { start: Date; end: Date } {
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

export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
