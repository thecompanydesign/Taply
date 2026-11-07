import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, SectionIntro, TEAM_ORDER_URL } from './shared'

const POINTS = [
  { title: 'One consistent brand', text: 'Your logo and colours on every card, so your team looks like one company.' },
  { title: 'A profile for every person', text: 'Each team member gets their own digital profile and fills in a 2-minute form, we do the rest.' },
  { title: 'One point of contact', text: 'We handle design, printing and delivery, and you talk to one team on WhatsApp.' },
]

const CARDS = 4
const FRONT = CARDS - 1
const STAGGER = 110 // ms between cards fanning out
const ENTRANCE = 900 // ms per card
const SHUFFLE_EVERY = 4500 // ms between deals
const DEAL = 900 // ms for one deal
const TAP_SPREAD = 1200 // ms the fan stays wide after a tap

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The fanned card stack. Each card sits in a slot (0 = back, 3 = front); the
 * slot sets its fan position through CSS variables, so moving a card is just
 * changing its slot. Every few seconds the front card is dealt to the back.
 * Only transform and opacity animate; everything pauses off screen, while
 * the stack is hovered or touched, and with reduced motion.
 */
function TeamStack() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const [entered, setEntered] = useState(false) // the fan-out has started
  const [live, setLive] = useState(false) // fan-out done: idle float + shuffle
  const [slots, setSlots] = useState(() => Array.from({ length: CARDS }, (_, i) => i))
  const slotsRef = useRef(slots)
  slotsRef.current = slots
  const [dealing, setDealing] = useState<number | null>(null)
  const [sheen, setSheen] = useState<{ card: number; n: number } | null>(null) // sweep on the card that just came to the front
  const [spread, setSpread] = useState(false)
  const held = useRef(false) // hovered or touched: no shuffles
  const spreadTimer = useRef(0)

  // On screen or not (pauses the loops), and the one-time entrance.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    if (reducedMotion() || !('IntersectionObserver' in window)) {
      setEntered(true)
      setLive(true)
      return
    }
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '0px 0px -15% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (inView && !entered) setEntered(true)
  }, [inView, entered])

  // Once the last card has landed, the stack goes live (idle float, pulse, deals).
  useEffect(() => {
    if (!entered || live) return
    const t = window.setTimeout(() => setLive(true), STAGGER * FRONT + ENTRANCE + 60)
    return () => window.clearTimeout(t)
  }, [entered, live])

  // The deal: front card to the back, the others forward one place.
  useEffect(() => {
    if (!live || !inView || reducedMotion()) return
    let wait = 0
    let finish = 0
    const deal = () => {
      if (held.current || document.hidden) {
        wait = window.setTimeout(deal, SHUFFLE_EVERY)
        return
      }
      const cur = slotsRef.current
      const next = cur.map((s) => (s === FRONT ? 0 : s + 1))
      setSheen(null)
      setDealing(cur.indexOf(FRONT))
      setSlots(next)
      finish = window.setTimeout(() => {
        setDealing(null)
        setSheen((prev) => ({ card: next.indexOf(FRONT), n: (prev?.n ?? 0) + 1 }))
        wait = window.setTimeout(deal, SHUFFLE_EVERY)
      }, DEAL)
    }
    wait = window.setTimeout(deal, SHUFFLE_EVERY)
    return () => {
      window.clearTimeout(wait)
      window.clearTimeout(finish)
    }
  }, [live, inView])

  useEffect(() => () => window.clearTimeout(spreadTimer.current), [])

  // Desktop: tilt toward the pointer (CSS eases it). Touch: a tap spreads the fan for a moment.
  const tilt = (x: number, y: number) => {
    tiltRef.current?.style.setProperty('--tilt-x', `${(x * 6).toFixed(2)}deg`)
    tiltRef.current?.style.setProperty('--tilt-y', `${(y * -6).toFixed(2)}deg`)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || reducedMotion()) return
    const r = e.currentTarget.getBoundingClientRect()
    tilt(((e.clientX - r.left) / r.width - 0.5) * 2, ((e.clientY - r.top) / r.height - 0.5) * 2)
  }
  const onEnter = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') held.current = true
  }
  const onLeave = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    held.current = false
    tilt(0, 0)
  }
  const onTap = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    held.current = true
    setSpread(true)
    window.clearTimeout(spreadTimer.current)
    spreadTimer.current = window.setTimeout(() => {
      setSpread(false)
      held.current = false
    }, TAP_SPREAD)
  }

  const cls = ['teams__visual', entered && 'is-in', live && 'is-live', inView && 'is-playing'].filter(Boolean).join(' ')
  return (
    <div className={cls} ref={wrapRef} aria-hidden="true">
      <span className="teams__circle" data-parallax="0.06" />
      <span className="teams__pulse">
        <i />
        <i />
      </span>
      <div className="teams__tilt" ref={tiltRef} onPointerMove={onMove} onPointerEnter={onEnter} onPointerLeave={onLeave} onPointerUp={onTap}>
        <div className={`teams__stack${spread ? ' is-spread' : ''}`}>
          {slots.map((slot, i) => (
            <div
              className={`teams__card${dealing === i ? ' is-dealing' : ''}`}
              key={i}
              data-slot={slot}
              style={{ '--n': i, '--slot': slot, '--float-d': `${-i * 1.7}s`, '--float-t': `${5 + i * 0.6}s` } as CSSProperties}
            >
              <div className="teams__float">
                <div className="pcard pcard--light">
                  <div className="pcard__face">
                    <BrandMark variant="symbol" className="teams__symbol" />
                    <span className="pcard__gloss">{sheen?.card === i && <span className="teams__sheen" key={sheen.n} />}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TeamsSection() {
  return (
    <section className="section teams" id="teams">
      <div className="container teams__grid">
        <div className="teams__copy stagger">
          <SectionIntro num="07" label="For teams" tone="lime" dark />
          <h2 className="h2 teams__title">
            Equip your <span className="accent-lime">whole team.</span>
          </h2>
          <p className="lede">One look, one order, a smart card and digital profile for everyone on your team.</p>
          <ol className="teams__points">
            {POINTS.map((p, i) => (
              <li key={p.title}>
                <span className="mono-label teams__num">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{p.title}</strong> {p.text}
                </span>
              </li>
            ))}
          </ol>
          <div className="teams__action">
            <CTA href={TEAM_ORDER_URL} variant="lime" external srNote={ORDER_LINK_NOTE}>
              Request a team quote
            </CTA>
            <p className="teams__note">Tell us how many cards you need and we'll take it from there.</p>
          </div>
        </div>

        <TeamStack />
      </div>
    </section>
  )
}
