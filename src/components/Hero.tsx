import { useRef } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { CTA, ORDER_LINK_NOTE, ORDER_URL } from './shared'
import { ProductCard } from './ProductCard'

const clamp = (v: number) => Math.max(-1, Math.min(1, v))

const LINES = [
  { text: 'Your' },
  { text: 'business card,' },
  { text: 'one tap away.', accent: true },
]

export function Hero() {
  const stageRef = useRef<HTMLDivElement>(null)
  const rearRef = useRef<HTMLDivElement>(null)
  const frontRef = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const target = useRef({ nx: 0, ny: 0 })

  const apply = () => {
    frame.current = 0
    const { nx, ny } = target.current
    // Depth: the field moves 6px, the rear card 4px less, the front card 2px
    // more (total ≤ 8px). The rear card also tilts ≤ 3.5°.
    if (stageRef.current) stageRef.current.style.transform = `translate3d(${nx * 6}px, ${ny * 6}px, 0)`
    if (rearRef.current)
      rearRef.current.style.transform = `translate3d(${nx * -2}px, ${ny * -2}px, 0) rotate(${nx * 3.5}deg)`
    if (frontRef.current) frontRef.current.style.transform = `translate3d(${nx * 2}px, ${ny * 2}px, 0)`
  }

  const onMove = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = e.currentTarget.getBoundingClientRect()
    target.current = {
      nx: clamp(((e.clientX - r.left) / r.width - 0.5) * 2),
      ny: clamp(((e.clientY - r.top) / r.height - 0.5) * 2),
    }
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }

  const reset = () => {
    target.current = { nx: 0, ny: 0 }
    if (!frame.current) frame.current = requestAnimationFrame(apply)
  }

  return (
    <section className="hero" id="top" data-loop onPointerMove={onMove} onPointerLeave={reset}>
      <div className="hero__bg" aria-hidden="true">
        <span className="hero__grid" />
        <span className="hero__lime-circle" data-parallax="0.08" />
      </div>

      <div className="container hero__inner">
        <div className="hero__copy">
          <p className="eyebrow eyebrow--plain hero__in" style={{ '--i': 0 } as CSSProperties}>
            <span>Plastic NFC smart business card</span>
            <span className="eyebrow__rule eyebrow__rule--violet" aria-hidden="true" />
          </p>
          <h1 className="display hero__title">
            {LINES.map((l, i) => (
              <span className={`line${l.accent ? ' accent' : ''}`} key={l.text}>
                <span className="line__in" style={{ '--i': i } as CSSProperties}>
                  {l.text}
                </span>
              </span>
            ))}
          </h1>
          <p className="lede hero__lede hero__in" style={{ '--i': 3 } as CSSProperties}>
            Tap or scan to open your profile. People save your contact, with no app needed.
          </p>
          <div className="hero__actions hero__in" style={{ '--i': 4 } as CSSProperties}>
            <CTA href={ORDER_URL} variant="violet" external srNote={ORDER_LINK_NOTE}>
              Get your Taply card — KES&nbsp;5,500
            </CTA>
            <CTA href="#how" variant="ghost">
              Discover how it works
            </CTA>
          </div>
          <p className="hero__team hero__in" style={{ '--i': 5 } as CSSProperties}>
            Ordering for a team? <a href="#teams">Request a quote</a>
          </p>
        </div>

        <div className="hero__visual">
          <div className="stage" ref={stageRef}>
            <span className="stage__field" aria-hidden="true" />
            <svg className="stage__orbits" viewBox="0 0 600 600" fill="none" aria-hidden="true">
              <circle cx="300" cy="300" r="190" />
              <circle cx="300" cy="300" r="250" />
              <circle cx="300" cy="300" r="296" />
            </svg>
            <span className="stage__rings" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="stage__shadow" aria-hidden="true" />

            <div className="stage__card stage__card--rear">
              <div className="stage__rotor" ref={rearRef}>
                <div className="float float--late">
                  <ProductCard variant="light" />
                </div>
              </div>
            </div>
            <div className="stage__card stage__card--front">
              <div className="stage__rotor" ref={frontRef}>
                <div className="float">
                  <ProductCard variant="dark" />
                </div>
              </div>
            </div>

            <p className="stage__note">No battery — NFC + QR</p>
          </div>
          <span className="hero__lime-leaf" aria-hidden="true" data-parallax="0.12" />
        </div>
      </div>

      <div className="hero__band">
        <div className="container">
          <p>Meet. Tap. Continue.</p>
        </div>
      </div>
    </section>
  )
}
