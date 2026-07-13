'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

const SECTIONS = [
  { href: '/', label: 'Overview' },
  { href: '/trading', label: 'Trading' },
  { href: '/net-worth', label: 'Net Worth' },
  { href: '/cash-flow', label: 'Cash Flow' },
]

export default function SectionNav() {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null))
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', gap: 24, height: 54 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          Trade Journal
        </div>
        <nav style={{ display: 'flex', gap: 4 }}>
          {SECTIONS.map(s => {
            const active = s.href === '/' ? pathname === '/' : pathname.startsWith(s.href)
            return (
              <Link
                key={s.href}
                href={s.href}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
                  textDecoration: 'none',
                  color: active ? 'var(--text)' : 'var(--text-muted)',
                  background: active ? 'var(--surface2)' : 'transparent',
                  transition: 'all 0.15s',
                }}
              >
                {s.label}
              </Link>
            )
          })}
        </nav>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {email && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{email}</span>}
          <button
            onClick={signOut}
            style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text-muted)', cursor: 'pointer', padding: '5px 12px', fontSize: 12,
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
