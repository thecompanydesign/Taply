import { useEffect, useRef, useState } from 'react'
import { BrandMark, CTA, MenuIcon, ORDER_LINK_NOTE, ORDER_URL } from './shared'

const LINKS = [
  { href: '#how', label: 'How it works' },
  { href: '#features', label: 'Features' },
  { href: '#teams', label: 'For teams' },
  { href: '#faq', label: 'FAQ' },
]

export function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false)
  const progressRef = useRef<HTMLSpanElement>(null)

  // Scroll progress goes straight to a CSS custom property (one rAF per
  // frame), so scrolling never re-renders the nav.
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      progressRef.current?.style.setProperty('--progress', p.toFixed(4))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    const onResize = () => window.innerWidth > 980 && setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [menuOpen])

  const close = () => setMenuOpen(false)

  return (
    <header className="nav-wrap">
      {/* Always mounted so it can fade and blur in step with the panel. */}
      <div className={`nav-backdrop${menuOpen ? ' is-open' : ''}`} aria-hidden="true" onClick={close} />
      <div className="container">
        <nav className="nav" aria-label="Primary">
          <a className="nav__brand" href="#top" aria-label="Taply — back to top" onClick={close}>
            <BrandMark variant="logo" alt="Taply" />
          </a>

          <ul className="nav__links">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>

          <CTA href={ORDER_URL} variant="violet" className="nav__cta" external srNote={ORDER_LINK_NOTE}>
            Get your Taply card
          </CTA>

          <button
            type="button"
            className="nav__toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MenuIcon open={menuOpen} />
          </button>

          <span className="nav__progress" ref={progressRef} aria-hidden="true" />
        </nav>

        <div id="mobile-menu" className={`nav-panel${menuOpen ? ' is-open' : ''}`}>
          <ul>
            {LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} onClick={close}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <CTA href={ORDER_URL} variant="violet" onClick={close} external srNote={ORDER_LINK_NOTE}>
            Get your Taply card
          </CTA>
        </div>
      </div>
    </header>
  )
}
