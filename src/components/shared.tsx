import type { ReactNode } from 'react'

/*
 * Orders go to WhatsApp. Edit the number or the prefilled message here; every
 * order button and the footer link use ORDER_URL. No checkout is built.
 */
export const WHATSAPP_NUMBER = '254140986500' // Kenya, international format without + or leading 0 (from 0140986500)
export const ORDER_MESSAGE = "Hi Taply! I'd like to order a Taply card (KES 5,500). Kindly help me get started."
export const ORDER_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(ORDER_MESSAGE)}`
export const TEAM_ORDER_MESSAGE = "Hi Taply! I'd like a quote for a team order. Kindly help me get started."
export const TEAM_ORDER_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(TEAM_ORDER_MESSAGE)}`
/** Screen-reader suffix for links that open WhatsApp. */
export const ORDER_LINK_NOTE = ' (opens WhatsApp in a new tab)'

export function Arrow({ direction = 'up-right' }: { direction?: 'up-right' | 'down' }) {
  return (
    <svg
      className={`arrow arrow--${direction}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 11 11 3M4.4 3H11v6.6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {open ? (
        <path d="M4 4 16 16M16 4 4 16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      ) : (
        <path d="M3 6h14M3 14h14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      )}
    </svg>
  )
}

type BrandMarkProps = {
  variant?: 'logo' | 'reversed' | 'symbol'
  className?: string
  alt?: string
}

/** Official Taply artwork, used unaltered. Never replaced with typeset text. */
export function BrandMark({ variant = 'logo', className, alt = '' }: BrandMarkProps) {
  const src = {
    logo: '/brand/taply-logo.png',
    reversed: '/brand/taply-logo-reversed.png',
    symbol: '/brand/taply-symbol.png',
  }[variant]
  // Lockup canvas is 1794×479 after the symbol enlargement (see scripts/resize-logo-symbol.py).
  const dims = variant === 'symbol' ? { width: 518, height: 405 } : { width: 1794, height: 479 }
  return <img className={className} src={src} alt={alt} decoding="async" {...dims} />
}

type CTAProps = {
  /** A link. Without it the CTA renders as a <button> (used by the onboarding form). */
  href?: string
  variant: 'violet' | 'lime' | 'white' | 'ghost'
  children: ReactNode
  external?: boolean
  /** Visually hidden text appended to the label (e.g. ORDER_LINK_NOTE). */
  srNote?: string
  className?: string
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
}

export function CTA({ href, variant, children, external, srNote, className = '', onClick, type = 'button', disabled }: CTAProps) {
  const externalProps = external ? { target: '_blank', rel: 'noopener noreferrer' } : {}
  const inner = (
    <>
      <span className="cta__label">
        {children}
        {srNote && <span className="sr-only">{srNote}</span>}
      </span>
      {variant === 'ghost' ? (
        <span className="cta__inline-arrow">
          <Arrow direction="down" />
        </span>
      ) : (
        <span className="cta__arrow">
          <Arrow />
        </span>
      )}
    </>
  )
  if (href === undefined)
    return (
      <button className={`cta cta--${variant} ${className}`} type={type} onClick={onClick} disabled={disabled}>
        {inner}
      </button>
    )
  return (
    <a className={`cta cta--${variant} ${className}`} href={href} onClick={onClick} {...externalProps}>
      {inner}
    </a>
  )
}

type SectionIntroProps = {
  num: string
  label: string
  tone?: 'violet' | 'lime'
  dark?: boolean
}

export function SectionIntro({ num, label, tone = 'violet', dark = false }: SectionIntroProps) {
  return (
    <p className={`eyebrow${dark ? ' eyebrow--dark' : ''}`}>
      <span className="eyebrow__num">{num}</span>
      <span>— {label}</span>
      <span className={`eyebrow__rule eyebrow__rule--${tone}`} aria-hidden="true" />
    </p>
  )
}
