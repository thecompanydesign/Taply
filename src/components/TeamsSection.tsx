import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, SectionIntro, TEAM_ORDER_URL } from './shared'

const POINTS = [
  { title: 'One consistent brand', text: 'Your logo and colours on every card, so your team looks like one company.' },
  { title: 'A profile for every person', text: 'Each team member gets their own digital profile and fills in a 2-minute form, we do the rest.' },
  { title: 'One point of contact', text: 'We handle design, printing and delivery, and you talk to one team on WhatsApp.' },
]

const N = 7 // cards on the ring
const STEP = 360 / N
const SPEED = 360 / 28000 // deg per ms: one turn every 28 s
const HOVER_SPEED = 0.3 // share of SPEED while a mouse is over the ring
const TILT = -8 // deg: the ring leans back, so we look down on it a little
const TILT_SCROLL = 3 // deg of extra tilt as the section scrolls past
const DRAG = 0.35 // deg per px dragged
const RESUME = 2000 // ms after release before auto-rotation returns
const MOMENT = 1400 // ms: the front card's flip + ripple
const ENTRY_STAGGER = 90
const ENTRY_CARD = 900
const ENTRY_SPIN = ENTRY_STAGGER * (N - 1) + 1100

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
/** Soft overshoot (back-out). */
const backOut = (t: number) => {
  const c = 1.2
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
}
/** Angle in (-180, 180]. */
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180

/**
 * A ring of seven identical cards in 3D. One rAF loop drives everything:
 * the entrance, the slow spin, dragging with inertia and a snap, the
 * scroll-linked tilt, and per-card depth (scale on the front card, a dark
 * shade on the others). Only transform and opacity change; the loop stops
 * off screen and while the tab is hidden. Reduced motion: a still ring.
 */
function OrbitRing() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [entered, setEntered] = useState(false)

  // Mutable animation state (no re-renders while it runs).
  const st = useRef({
    rot: 0,
    vel: 0, // deg/ms, after a drag
    speed: 1, // share of SPEED, eased toward its target
    dragging: false,
    hover: false,
    startX: 0,
    startRot: 0,
    lastX: 0,
    lastT: 0,
    resumeAt: 0,
    snapTo: null as number | null,
    entryStart: 0, // 0 = no entrance running
    didEnter: false, // the entrance plays once
    momentCard: -1,
    shade: [] as number[],
    scale: [] as number[],
  })

  useEffect(() => {
    const root = wrapRef.current
    const ring = ringRef.current
    if (!root || !ring) return
    const s = st.current
    const reduced = reducedMotion()

    const paint = (tilt: number) => {
      ring.style.transform = `rotateX(${tilt.toFixed(2)}deg) rotateY(${s.rot.toFixed(2)}deg)`
      for (let i = 0; i < N; i++) {
        const facing = Math.cos((wrap(i * STEP + s.rot) * Math.PI) / 180) // 1 = facing us
        const shade = Number((((1 - facing) / 2) * 0.5).toFixed(3))
        const scale = Number((1 + 0.08 * Math.pow(Math.max(0, facing), 8)).toFixed(3))
        if (s.shade[i] !== shade) {
          slotRefs.current[i]?.style.setProperty('--shade', String(shade))
          s.shade[i] = shade
        }
        if (s.scale[i] !== scale) {
          const card = cardRefs.current[i]
          if (card) card.style.transform = `scale(${scale})`
          s.scale[i] = scale
        }
      }
    }

    if (reduced) {
      s.rot = 0
      paint(TILT)
      setEntered(true)
      return
    }

    let raf = 0
    let last = 0
    let inView = false
    const timers = new Set<number>()

    const moment = (i: number) => {
      const card = cardRefs.current[i]
      if (!card || card.classList.contains('is-moment')) return
      card.classList.add('is-moment')
      const t = window.setTimeout(() => {
        card.classList.remove('is-moment')
        timers.delete(t)
      }, MOMENT)
      timers.add(t)
    }

    const frame = (now: number) => {
      raf = 0
      const dt = last ? Math.min(64, now - last) : 16
      last = now

      // Reads first: how far the section has scrolled past the middle of the screen.
      const r = root.getBoundingClientRect()
      const off = clamp((r.top + r.height / 2 - innerHeight / 2) / innerHeight, -1, 1)
      const tilt = TILT + off * TILT_SCROLL

      if (s.entryStart) {
        // Entrance: one pile, then each card unfurls to its place while the ring turns once.
        const t = now - s.entryStart
        for (let i = 0; i < N; i++) {
          const p = backOut(clamp((t - i * ENTRY_STAGGER) / ENTRY_CARD, 0, 1))
          const slot = slotRefs.current[i]
          if (slot) slot.style.transform = `rotateY(${(i * STEP * p).toFixed(2)}deg) translateZ(calc(var(--radius) * ${p.toFixed(3)}))`
        }
        s.rot = -360 * (1 - easeOut(clamp(t / ENTRY_SPIN, 0, 1)))
        if (t >= Math.max(ENTRY_SPIN, ENTRY_STAGGER * (N - 1) + ENTRY_CARD)) {
          s.entryStart = 0
          s.rot = 0
          slotRefs.current.forEach((el) => el?.style.removeProperty('transform'))
        }
      } else if (s.dragging) {
        // The pointer sets the angle directly.
      } else if (Math.abs(s.vel) > 0.004) {
        // Inertia after a fling.
        s.rot += s.vel * dt
        s.vel *= Math.exp(-dt / 320)
        if (Math.abs(s.vel) <= 0.004) s.snapTo = Math.round(s.rot / STEP) * STEP
      } else if (s.snapTo !== null && now < s.resumeAt) {
        // Soft snap to the nearest card.
        s.rot += (s.snapTo - s.rot) * (1 - Math.exp(-dt / 140))
      } else {
        s.snapTo = null
        const target = now < s.resumeAt ? 0 : s.hover ? HOVER_SPEED : 1
        s.speed += (target - s.speed) * (1 - Math.exp(-dt / 500))
        s.rot += SPEED * s.speed * dt
      }
      if (Math.abs(s.rot) > 3600) s.rot = wrap(s.rot)

      // The card that reaches the front plays its moment (not while it's being dragged).
      if (!s.entryStart && !s.dragging) {
        const front = Math.round(-s.rot / STEP)
        const i = ((front % N) + N) % N
        if (Math.abs(wrap(i * STEP + s.rot)) < 4 && s.momentCard !== i) {
          s.momentCard = i
          moment(i)
        } else if (Math.abs(wrap(i * STEP + s.rot)) > STEP / 2) {
          s.momentCard = -1
        }
      }

      paint(tilt)
      if (inView && !document.hidden) raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (!raf && inView && !document.hidden) {
        last = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const io = new IntersectionObserver(
      ([e]) => {
        inView = e.isIntersecting
        if (inView && !s.didEnter) {
          s.didEnter = true
          setEntered(true)
          s.entryStart = performance.now()
        }
        if (inView) start()
        else stop()
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(root)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    paint(TILT)

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      stop()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])

  // Drag / swipe to spin. touch-action: pan-y keeps vertical scrolling native.
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (reducedMotion() || s.entryStart || (e.pointerType === 'mouse' && e.button !== 0)) return
    s.dragging = true
    s.vel = 0
    s.snapTo = null
    s.startX = s.lastX = e.clientX
    s.startRot = s.rot
    s.lastT = performance.now()
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (!s.dragging) return
    const now = performance.now()
    const dt = Math.max(1, now - s.lastT)
    s.vel = clamp(((e.clientX - s.lastX) * DRAG) / dt, -1.2, 1.2) * 0.6 + s.vel * 0.4
    s.lastX = e.clientX
    s.lastT = now
    s.rot = s.startRot + (e.clientX - s.startX) * DRAG
  }
  const onUp = () => {
    const s = st.current
    if (!s.dragging) return
    s.dragging = false
    // A tap, or a vertical scroll the browser took over: leave the ring spinning.
    if (Math.abs(s.lastX - s.startX) < 4) {
      s.rot = s.startRot + (s.lastX - s.startX) * DRAG
      s.vel = 0
      return
    }
    if (performance.now() - s.lastT > 80) s.vel = 0 // held still before letting go
    if (Math.abs(s.vel) <= 0.004) s.snapTo = Math.round(s.rot / STEP) * STEP
    s.resumeAt = performance.now() + RESUME
    s.speed = 0
  }

  return (
    <div className={`teams__visual${entered ? ' is-in' : ''}`} ref={wrapRef} aria-hidden="true">
      <span className="teams__circle" data-parallax="0.06" />
      <div
        className="orbit"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerEnter={(e) => e.pointerType === 'mouse' && (st.current.hover = true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && (st.current.hover = false)}
      >
        <div className="orbit__ring" ref={ringRef}>
          {Array.from({ length: N }, (_, i) => (
            <div className="orbit__slot" key={i} ref={(el) => void (slotRefs.current[i] = el)} style={{ '--i': i } as CSSProperties}>
              <div className="orbit__card" ref={(el) => void (cardRefs.current[i] = el)}>
                <div className="orbit__flip">
                  <div className="pcard pcard--light orbit__face">
                    <div className="pcard__face">
                      <BrandMark variant="symbol" className="orbit__symbol" />
                      <span className="pcard__gloss" />
                      <span className="orbit__shade" />
                    </div>
                  </div>
                  <div className="pcard pcard--dark orbit__face orbit__face--back">
                    <div className="pcard__face">
                      <img className="orbit__qr" src="/brand/taply-qr.svg" alt="" width="264" height="264" decoding="async" draggable={false} />
                      <span className="pcard__gloss" />
                      <span className="orbit__shade" />
                    </div>
                  </div>
                </div>
                <span className="orbit__ripple">
                  <i />
                  <i />
                </span>
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

        <OrbitRing />
      </div>
    </section>
  )
}
