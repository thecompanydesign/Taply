import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, SectionIntro, TEAM_ORDER_URL } from './shared'

const POINTS = [
  { title: 'One consistent brand', text: 'Your logo and colours on every card, so your team looks like one company.' },
  { title: 'A profile for every person', text: 'Each team member gets their own digital profile and fills in a 2-minute form, we do the rest.' },
  { title: 'One point of contact', text: 'We handle design, printing and delivery, and you talk to one team on WhatsApp.' },
]

const N = 4 // cards on the ring, 90 degrees apart
const STEP = 360 / N
const SPEED = 360 / 20000 // deg per ms: one turn every 20 s
const HOVER_SPEED = 0.3 // share of SPEED while a mouse is over the ring (orbit phase only)
const TILT = -8 // deg: the ring leans back, so we look down on it a little
const TILT_SCROLL = 3 // deg of extra tilt as the section scrolls past
const DRAG = 0.35 // deg per px dragged
const RESUME = 2000 // ms after release before the cycle continues
const MOMENT = 1400 // ms: the front card's flip + ripple (orbit phase only)

/** The loop, in ms: orbit, gather into a stack, hold, release back to the ring. */
export const ORBIT_CYCLE = { orbit: 8000, gather: 2100, stack: 2200, release: 2100 } as const
const GATHER_FIRST = 250 // the first card leaves while the ring is slowing down
const GATHER_DECEL = 650 // the ring eases to a stop over this long
const GATHER_STAGGER = 170
const RELEASE_STAGGER = 190 // top card first
const ENTRY_STAGGER = 110
const ENTRY_FLIGHT = 1100
const ENTRY_SPIN = ENTRY_STAGGER * (N - 1) + 1400
const RETURN_MS = 450 // cards fly home when someone grabs the ring mid-cycle
const STACK_CONTRACT = 0.8 // ring radius while the cards are piled

// Each card's place in the stack, bottom (0) to top (3): offsets in card
// widths, a few degrees of turn, a little depth so they never intersect.
// The vertical steps keep every card's edge visible.
const STACK_ROT = [-5, 5, -2, 2]
const STACK_X = [-0.03, 0.03, -0.015, 0]
const STACK_Y = [0.075, 0.05, 0.025, 0]
const STACK_Z = 0.035 // card widths between layers
const STACK_SCALE = 1.22

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
/** Angle in (-180, 180]. */
const wrap = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of time (Newton steps, then bisection). */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t
  const sy = (t: number) => ((ay * t + by) * t + cy) * t
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (sx(t) - x) / d
    }
    if (t < 0 || t > 1 || Math.abs(sx(t) - x) > 1e-4) {
      let lo = 0, hi = 1
      t = x
      for (let i = 0; i < 20; i++) {
        if (sx(t) < x) lo = t
        else hi = t
        t = (lo + hi) / 2
      }
    }
    return sy(t)
  }
}
/** Card flights: a smooth ease-in-out with a long, soft landing. No overshoot or bounce. */
const flightEase = cubicBezier(0.45, 0.05, 0.15, 1)
/** Speed changes of the ring: smooth at both ends. */
const smooth = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

type Phase = 'pile' | 'entry' | 'orbit' | 'gather' | 'stack' | 'release' | 'return'

/**
 * A ring of four identical cards in 3D that loops through four phases:
 * orbit, gather (cards sweep in from the back and pile up), stack (a short
 * hold with a sheen and a tap ripple), release (cards fly back out).
 *
 * Every card has a ring pose (its angle on the ring) and a stack pose (its
 * layer in the pile). One number per card, p (0 = ring, 1 = stack), blends
 * the two along a curved path: the angle swings toward the front while the
 * radius shrinks, with a small arc toward the viewer, so a card never cuts
 * through the pile. One rAF loop on its own clock writes only transforms and
 * the shade opacity; the clock stops off screen and in a hidden tab.
 * Reduced motion: a still ring.
 */
function OrbitRing() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<HTMLDivElement>(null)
  const pulseRef = useRef<HTMLSpanElement>(null)
  const slotRefs = useRef<(HTMLDivElement | null)[]>([])
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const [entered, setEntered] = useState(false)

  // Mutable animation state (no re-renders while it runs).
  const st = useRef({
    clock: 0, // ms of animation time (frozen while paused)
    phase: 'pile' as Phase,
    phaseAt: 0, // clock time the phase began
    rot: 0,
    vel: 0, // deg/ms, after a drag
    speed: 1, // share of SPEED, eased toward its target
    dragging: false,
    moved: false,
    hover: false,
    startX: 0,
    startRot: 0,
    lastX: 0,
    lastT: 0,
    resumeAt: -1, // clock time the cycle may continue after a drag
    snapTo: null as number | null,
    contract: 1, // ring radius factor (shrinks while cards leave it)
    p: Array.from({ length: N }, () => 1), // per card: 0 = ring, 1 = stack (starts piled)
    pFrom: Array.from({ length: N }, () => 1),
    layer: Array.from({ length: N }, (_, i) => i), // stack layer per card (6 = top)
    momentCard: -1,
    // While cards fly (entry, gather, release, return), each card's ring angle
    // is followed continuously from where it was when the phase began, so it
    // never wraps from +180 to -180 (a jump to the other side) mid-flight.
    base: Array.from({ length: N }, () => 0),
    rotBase: 0,
    speedFrom: 1, // ring speed when the gather began
    shade: [] as number[],
    pose: [] as string[],
    didEnter: false,
    timers: new Set<number>(),
    release: () => {},
  })

  useEffect(() => {
    const root = wrapRef.current
    const ring = ringRef.current
    if (!root || !ring) return
    const s = st.current
    const reduced = reducedMotion()
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        s.timers.delete(t)
        fn()
      }, ms)
      s.timers.add(t)
    }
    const flash = (el: Element | null | undefined, cls: string, ms: number) => {
      if (!el || el.classList.contains(cls)) return
      el.classList.add(cls)
      later(() => el.classList.remove(cls), ms)
    }

    /** Places every card from its blend value p (0 ring .. 1 stack). */
    const paint = (tilt: number) => {
      ring.style.transform = `rotateX(${tilt.toFixed(2)}deg)`
      // One gentle rise and fall over the hold: zero at both ends, so the
      // stack meets the gather and release without a step.
      const breathe = s.phase === 'stack' ? -0.008 * Math.sin(Math.PI * clamp((s.clock - s.phaseAt) / ORBIT_CYCLE.stack, 0, 1)) : 0
      const flying = s.phase !== 'orbit' && s.phase !== 'stack'
      for (let i = 0; i < N; i++) {
        const p = s.p[i]
        const k = s.layer[i]
        const ringAngle = flying ? s.base[i] + (s.rot - s.rotBase) : wrap(i * STEP + s.rot)
        const facing = Math.cos((ringAngle * Math.PI) / 180) // 1 = facing us
        // Ring part: angle swings to the front and the radius shrinks to 0 as p rises.
        const a = ringAngle * (1 - p)
        const r = s.contract * (1 - p)
        const ax = r * Math.sin((a * Math.PI) / 180)
        const az = r * Math.cos((a * Math.PI) / 180)
        // Stack part, plus an arc up and toward the viewer mid-flight.
        const arc = Math.sin(Math.PI * clamp(p, 0, 1))
        const bx = STACK_X[k] * p
        // Gathering cards arc toward the viewer, so they land on the pile from
        // the front; released cards arc up and over, clear of the cards
        // already back on the ring.
        const out = s.phase === 'release' || s.phase === 'entry' || s.phase === 'return'
        const by = (STACK_Y[k] + breathe) * p - (out ? 0.42 : 0.2) * arc
        const bz = k * STACK_Z * p + (out ? 0.12 : 0.45) * arc
        // A card in flight keeps facing us and turns to its ring angle only
        // near the ring, so it never passes edge-on through another card.
        const ry = ringAngle * Math.pow(1 - p, 1.8)
        const spin = s.phase === 'release' || s.phase === 'entry' ? 14 * arc * (i % 2 ? 1 : -1) : 0
        const rz = STACK_ROT[k] * p + spin
        const ringScale = 1 + 0.08 * Math.pow(Math.max(0, facing), 8)
        const sc = ringScale + (STACK_SCALE - ringScale) * p
        const pose =
          `translate3d(calc(var(--radius) * ${ax.toFixed(4)} + var(--card-w) * ${bx.toFixed(4)}), ` +
          `calc(var(--card-w) * ${by.toFixed(4)}), calc(var(--radius) * ${az.toFixed(4)} + var(--card-w) * ${bz.toFixed(4)})) ` +
          `rotateX(${(-tilt * p).toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${sc.toFixed(4)})`
        if (s.pose[i] !== pose) {
          const slot = slotRefs.current[i]
          if (slot) slot.style.transform = pose
          s.pose[i] = pose
        }
        const shadeRing = ((1 - facing) / 2) * 0.5
        const shade = Number((shadeRing + ((N - 1 - k) * 0.04 - shadeRing) * p).toFixed(3))
        if (s.shade[i] !== shade) {
          slotRefs.current[i]?.style.setProperty('--shade', String(shade))
          s.shade[i] = shade
        }
      }
    }

    if (reduced) {
      s.p.fill(0)
      s.phase = 'orbit' // a still ring (no cycle)
      s.rot = -30 // turned so all four cards show
      paint(TILT)
      setEntered(true)
      return
    }

    /** Freezes each card's current ring angle as the start of a continuous flight. */
    const anchor = () => {
      for (let i = 0; i < N; i++) s.base[i] = wrap(i * STEP + s.rot)
      s.rotBase = s.rot
    }
    const go = (phase: Phase) => {
      s.phase = phase
      s.phaseAt = s.clock
      root.dataset.phase = phase
      s.pFrom = [...s.p]
      if (phase !== 'orbit' && phase !== 'stack') anchor()
      if (phase === 'gather') s.speedFrom = s.speed
      if (phase === 'gather') {
        // Back of the ring first; the card at the front arrives last, on top.
        const order = Array.from({ length: N }, (_, i) => i).sort(
          (x, y) => Math.cos((wrap(x * STEP + s.rot) * Math.PI) / 180) - Math.cos((wrap(y * STEP + s.rot) * Math.PI) / 180),
        )
        order.forEach((card, rank) => (s.layer[card] = rank))
      }
      if (phase === 'stack') {
        const top = s.layer.indexOf(N - 1)
        later(() => {
          if (s.phase !== 'stack') return
          flash(cardRefs.current[top], 'is-sheen', 1400)
          flash(pulseRef.current, 'is-on', 1300)
        }, 300)
      }
    }
    // Lets a tap on the stack start the release right away.
    s.release = () => s.phase === 'stack' && go('release')

    let raf = 0
    let last = 0
    let inView = false

    const frame = (now: number) => {
      raf = 0
      const dt = last ? Math.min(64, now - last) : 16
      last = now
      s.clock += dt
      const t = s.clock - s.phaseAt

      // Reads first: how far the section has scrolled past the middle of the screen.
      const r = root.getBoundingClientRect()
      const off = clamp((r.top + r.height / 2 - innerHeight / 2) / innerHeight, -1, 1)
      const tilt = TILT + off * TILT_SCROLL

      switch (s.phase) {
        case 'entry': {
          // One pile unfurls into the ring while the ring turns once.
          for (let i = 0; i < N; i++) {
            const rank = N - 1 - s.layer[i]
            s.p[i] = 1 - flightEase(clamp((t - rank * ENTRY_STAGGER) / ENTRY_FLIGHT, 0, 1))
          }
          s.rot = -360 * (1 - easeOutCubic(clamp(t / ENTRY_SPIN, 0, 1)))
          if (t >= Math.max(ENTRY_SPIN, ENTRY_STAGGER * (N - 1) + ENTRY_FLIGHT)) {
            s.p.fill(0)
            s.rot = 0
            go('orbit')
          }
          break
        }
        case 'gather': {
          // The ring eases to a stop as the first card leaves; the cards then
          // sweep in from the back, one by one, and land on the pile.
          s.speed = s.speedFrom * (1 - smooth(t / GATHER_DECEL))
          s.rot += SPEED * s.speed * dt
          const flight = ORBIT_CYCLE.gather - GATHER_FIRST - GATHER_STAGGER * (N - 1)
          for (let i = 0; i < N; i++) {
            const start = GATHER_FIRST + s.layer[i] * GATHER_STAGGER
            s.p[i] = flightEase(clamp((t - start) / flight, 0, 1))
          }
          s.contract = 1 - (1 - STACK_CONTRACT) * smooth(t / ORBIT_CYCLE.gather)
          if (t >= ORBIT_CYCLE.gather) {
            s.p.fill(1)
            go('stack')
          }
          break
        }
        case 'stack':
          if (t >= ORBIT_CYCLE.stack) go('release')
          break
        case 'release': {
          // The cards peel off from the top, each easing back to its place on
          // the ring, while the ring's speed builds smoothly from zero to normal.
          const flight = ORBIT_CYCLE.release - RELEASE_STAGGER * (N - 1)
          for (let i = 0; i < N; i++) {
            const start = (N - 1 - s.layer[i]) * RELEASE_STAGGER
            s.p[i] = 1 - flightEase(clamp((t - start) / flight, 0, 1))
          }
          s.contract = STACK_CONTRACT + (1 - STACK_CONTRACT) * smooth(t / ORBIT_CYCLE.release)
          s.speed = smooth(t / ORBIT_CYCLE.release)
          s.rot += SPEED * s.speed * dt
          if (t >= ORBIT_CYCLE.release) {
            s.p.fill(0)
            s.contract = 1
            s.speed = 1
            go('orbit')
          }
          break
        }
        case 'return': {
          // Someone grabbed the ring mid-cycle: every card flies home quickly.
          const q = easeOutCubic(clamp(t / RETURN_MS, 0, 1))
          for (let i = 0; i < N; i++) s.p[i] = s.pFrom[i] * (1 - q)
          s.contract += (1 - s.contract) * q
          if (q >= 1) {
            s.p.fill(0)
            s.contract = 1
            s.phase = 'orbit' // the user now has the ring; the cycle restarts after they let go
            s.phaseAt = s.clock
            root.dataset.phase = 'orbit'
          }
          break
        }
        default:
          break
      }

      // Ring motion in the orbit phase (and while handing back control).
      if (s.phase === 'orbit') {
        if (s.dragging) {
          // The pointer sets the angle directly.
        } else if (Math.abs(s.vel) > 0.004) {
          s.rot += s.vel * dt
          s.vel *= Math.exp(-dt / 320)
          if (Math.abs(s.vel) <= 0.004) s.snapTo = Math.round(s.rot / STEP) * STEP
        } else if (s.snapTo !== null && s.clock < s.resumeAt) {
          s.rot += (s.snapTo - s.rot) * (1 - Math.exp(-dt / 140))
        } else {
          s.snapTo = null
          const waiting = s.clock < s.resumeAt
          const target = waiting ? 0 : s.hover ? HOVER_SPEED : 1
          s.speed += (target - s.speed) * (1 - Math.exp(-dt / 500))
          s.rot += SPEED * s.speed * dt
          // After a drag, the orbit phase starts afresh once the ring is moving again.
          if (s.resumeAt >= 0 && !waiting) {
            s.resumeAt = -1
            s.phaseAt = s.clock
          }
          if (s.clock - s.phaseAt >= ORBIT_CYCLE.orbit && s.resumeAt < 0) go('gather')
        }
      }
      if (s.phase === 'orbit' && Math.abs(s.rot) > 3600) s.rot = wrap(s.rot)

      // The front card's QR flip + ripple: orbit phase only, never while cards are in flight.
      if (s.phase === 'orbit' && !s.dragging && s.p.every((v) => v === 0)) {
        const front = Math.round(-s.rot / STEP)
        const i = ((front % N) + N) % N
        const off2 = Math.abs(wrap(i * STEP + s.rot))
        // Only if the flip can finish before the cards start gathering.
        const left = s.resumeAt >= 0 ? Infinity : ORBIT_CYCLE.orbit - (s.clock - s.phaseAt)
        if (off2 < 4 && s.momentCard !== i && left > MOMENT + 100) {
          s.momentCard = i
          flash(cardRefs.current[i], 'is-moment', MOMENT)
        } else if (off2 > STEP / 2) {
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
          go('entry')
        }
        if (inView) start()
        else stop()
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(root)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    paint(TILT) // the pile, until the section scrolls into view

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      stop()
      s.timers.forEach((t) => window.clearTimeout(t))
      s.timers.clear()
    }
  }, [])

  // Drag / swipe to spin. touch-action: pan-y keeps vertical scrolling native.
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (reducedMotion() || s.phase === 'entry' || s.phase === 'pile' || (e.pointerType === 'mouse' && e.button !== 0)) return
    s.dragging = true
    s.moved = false
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
    if (!s.moved && Math.abs(e.clientX - s.startX) >= 4) {
      s.moved = true
      // Grabbed mid-cycle: send the cards home and hand the ring to the user.
      if (s.phase === 'gather' || s.phase === 'stack' || s.phase === 'release') {
        s.phase = 'return'
        s.phaseAt = s.clock
        s.pFrom = [...s.p]
        // Follow each card's angle continuously from here (see `base`).
        for (let i = 0; i < N; i++) s.base[i] = wrap(i * STEP + s.rot)
        s.rotBase = s.rot
        if (wrapRef.current) wrapRef.current.dataset.phase = 'return'
      }
      s.startX = e.clientX
      s.startRot = s.rot
    }
    if (!s.moved) return
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
    // A tap, or a vertical scroll the browser took over: no drag happened.
    if (!s.moved) {
      s.vel = 0
      s.release() // a tap on the stack lets the cards go at once
      return
    }
    if (performance.now() - s.lastT > 80) s.vel = 0 // held still before letting go
    if (Math.abs(s.vel) <= 0.004) s.snapTo = Math.round(s.rot / STEP) * STEP
    s.resumeAt = s.clock + RESUME
    s.speed = 0
  }

  return (
    <div className={`teams__visual${entered ? ' is-in' : ''}`} ref={wrapRef} aria-hidden="true">
      <span className="teams__circle" data-parallax="0.06" />
      <span className="orbit__pulse" ref={pulseRef}>
        <i />
        <i />
      </span>
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
