import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { CTA, ORDER_LINK_NOTE, ORDER_URL, SectionIntro } from './shared'
import { ProductCard } from './ProductCard'

const PRICE = 5500
const PRICE_TEXT = '5,500'

const INCLUDED = [
  'Physical NFC card',
  'Personalised digital profile',
  'NFC + QR sharing',
  'Profile updates without reprinting',
  'No app needed for recipients',
]

/**
 * Counts the price up to its final value once, when it scrolls into view.
 * The markup always renders the exact final value; the count only runs with
 * JS, without reduced motion, and only if the price starts below the fold.
 */
function useCountUp(ref: RefObject<HTMLSpanElement | null>) {
  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return

    // Lock the width so changing digits never shift anything.
    el.style.minWidth = `${el.getBoundingClientRect().width}px`
    el.textContent = '0'
    let raf = 0

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        const start = performance.now()
        const DURATION = 1400
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION)
          const eased = 1 - Math.pow(1 - t, 3)
          el.textContent = t < 1 ? Math.round(PRICE * eased).toLocaleString('en-US') : PRICE_TEXT
          if (t < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      },
      { threshold: 0.6 },
    )
    io.observe(el)

    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
      el.textContent = PRICE_TEXT
      el.style.minWidth = ''
    }
  }, [ref])
}

export function PricingSection() {
  const numRef = useRef<HTMLSpanElement>(null)
  useCountUp(numRef)

  return (
    <section className="section pricing" id="pricing">
      <div className="container">
        <div className="panel trigger">
          <div className="panel__main">
            <div className="panel__copy stagger">
              <SectionIntro num="06" label="The Taply card" />
              <h2 className="h2 panel__title">Your next introduction starts here.</h2>
              <p className="lede">
                One versatile plastic NFC card, connected to your personalised digital business profile.
              </p>

              {/* The price row sets this block's width; the button fills it (desktop). */}
              <div className="panel__buy">
                <p className="price">
                  <span className="sr-only">KES {PRICE_TEXT}</span>
                  <span className="price__cur" aria-hidden="true">
                    KES
                  </span>
                  <span className="price__num" aria-hidden="true" ref={numRef}>
                    {PRICE_TEXT}
                  </span>
                </p>
                <CTA href={ORDER_URL} variant="lime" external srNote={ORDER_LINK_NOTE}>
                  Get your Taply card
                </CTA>
              </div>

              <div className="panel__action">
                <p className="panel__note">One-off cost. Update your digital profile anytime at no extra cost, and share it with a tap or scan. No app needed for anyone you meet.</p>
                <p className="panel__team">
                  Need cards for a team? <a href="#teams">See team orders.</a>
                </p>
              </div>
            </div>

            <div className="panel__visual" aria-hidden="true">
              <span className="panel__circle" data-parallax="0.06" />
              <div className="panel__card panel__card--rear">
                <ProductCard variant="light" />
              </div>
              <div className="panel__card panel__card--front">
                <ProductCard variant="dark" />
              </div>
            </div>
          </div>

          <ul className="included stagger">
            {INCLUDED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
