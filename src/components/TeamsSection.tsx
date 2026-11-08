import { useEffect, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, SectionIntro, TEAM_ORDER_URL } from './shared'

const POINTS = [
  { title: 'One consistent brand', text: 'Your logo and colours on every card, so your team looks like one company.' },
  { title: 'A profile for every person', text: 'Each team member gets their own digital profile and fills in a 2-minute form, we do the rest.' },
  { title: 'One point of contact', text: 'We handle design, printing and delivery, and you talk to one team on WhatsApp.' },
]

const N = 4 // cards in the pile

/** The loop, in ms: stack, deal (two cards to the back), fan open, tap wave, gather. */
export const TEAMS_CYCLE = { stack: 2400, deal: 2400, fan: 1600, tap: 3200, gather: 1800 } as const
type Phase = keyof typeof TEAMS_CYCLE
const NEXT: Record<Phase, Phase> = { stack: 'deal', deal: 'fan', fan: 'tap', tap: 'gather', gather: 'stack' }

const DEAL_MS = 1100 // one card's trip from the top to the back of the pile
const DEAL_AT = [0, 1200] // when each of the two deals starts
const DEAL_OUT = 0.78 // card widths the dealt card swings out to the right
const DEAL_DIP = 0.05 // it goes out a little low and comes back a little high
const DEAL_TURN = 8 // deg of extra turn at the far point
const DEAL_SCALE = 0.8 // it shrinks as it goes round the back
const PILE_SHIFT = 0.2 // card widths the rest of the pile slides left to make room
const FAN_STAGGER = 60
const FAN_FLIGHT = TEAMS_CYCLE.fan - FAN_STAGGER * (N - 1)
const GATHER_STAGGER = 110
const GATHER_FLIGHT = TEAMS_CYCLE.gather - GATHER_STAGGER * (N - 1)
const SETTLE_MS = 700 // hold phases ease from wherever a skip left the cards
const WAVE_START = 150
const WAVE_STEP = 550 // the NFC pulse reaches the next card
const RISE_PX = 10
const RISE_MS = 800
const GLOW_MS = 900
const RIPPLE_MS = 1100
const RIPPLE_GAP = 220
const TILT_MAX = 5 // deg, toward the pointer (desktop)

// Each card's place in the pile, bottom (0) to top (3): offsets in card
// widths and a few degrees of turn, so every card's edge shows.
const STACK_ROT = [-5, 5, -2, 2]
const STACK_X = [-0.03, 0.03, -0.015, 0]
const STACK_Y = [0.0375, 0.0125, -0.0125, -0.0375]
// The fan: a hand of cards turning about a point below the pile, left (0) to right (3).
const FAN = {
  wide: { angles: [-24, -8, 8, 24], radius: 2.2, scale: 0.78 },
  narrow: { angles: [-18, -6, 6, 18], radius: 2.8, scale: 0.76 },
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const unit = (v: number) => clamp(v, 0, 1)

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
/** The site's easing, cubic-bezier(0.2, 0.8, 0.2, 1): a long, soft ease-out with no overshoot. */
const ease = cubicBezier(0.2, 0.8, 0.2, 1)
/** The deal: a symmetric ease-in-out, so the far point of the trip is exactly halfway. */
const easeInOut = cubicBezier(0.45, 0, 0.55, 1)

/** A card's pose: offsets in card widths, turn in deg, scale, Carbon shade (0..1). */
type Pose = { x: number; y: number; r: number; s: number; sh: number }
const mix = (a: Pose, b: Pose, k: number): Pose => ({
  x: a.x + (b.x - a.x) * k,
  y: a.y + (b.y - a.y) * k,
  r: a.r + (b.r - a.r) * k,
  s: a.s + (b.s - a.s) * k,
  sh: a.sh + (b.sh - a.sh) * k,
})
const stackPose = (k: number): Pose => ({ x: STACK_X[k], y: STACK_Y[k], r: STACK_ROT[k], s: 1, sh: (N - 1 - k) * 0.04 })
const fanPose = (k: number, narrow: boolean): Pose => {
  const f = narrow ? FAN.narrow : FAN.wide
  const rad = (f.angles[k] * Math.PI) / 180
  const reach = f.radius * f.scale
  const arch = reach * (1 - Math.cos((Math.max(...f.angles) * Math.PI) / 180))
  return { x: reach * Math.sin(rad), y: reach * (1 - Math.cos(rad)) - arch / 2, r: f.angles[k], s: f.scale, sh: (N - 1 - k) * 0.015 }
}
/** 0 -> 1 -> 0 over `ms` from `at`, smooth at both ends. */
const bump = (t: number, at: number, ms: number) => Math.sin(Math.PI * unit((t - at) / ms)) ** 2

/**
 * Four identical cards that loop: a neat pile (stack), two cards dealt from
 * the top to the back (deal), a hand-of-cards fan (fan), a lime NFC pulse
 * across the fan (tap), and back into the pile (gather).
 *
 * Each card has a layer (its place in the pile, 0 = bottom). Its fan slot is
 * the same number, so the overlap order is the same in the pile and the fan
 * (right over left), and z-index only changes for a dealt card, at the far
 * point of its trip, where it is clear of the pile. Every phase eases from
 * the poses the cards had when it began, so a skip never jumps. One rAF loop
 * on its own clock writes transforms and opacities only; it stops off screen
 * and in a hidden tab. Reduced motion: the still fan.
 */
function CardFan() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tiltRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const glowRefs = useRef<(HTMLSpanElement | null)[]>([])
  const ringRefs = useRef<(HTMLElement | null)[]>([])
  const [entered, setEntered] = useState(false)

  // Mutable animation state (no re-renders while it runs).
  const st = useRef({
    clock: 0, // ms of animation time (frozen while paused)
    phase: 'stack' as Phase,
    phaseAt: 0,
    layer: Array.from({ length: N }, (_, i) => i),
    from: Array.from({ length: N }, (_, i) => stackPose(i)),
    now: Array.from({ length: N }, (_, i) => stackPose(i)),
    // The deal phase: layers before, after the first and after the second deal.
    deal: [[0, 1, 2, 3], [0, 1, 2, 3], [0, 1, 2, 3]] as number[][],
    dealt: [-1, -1], // the card each deal moves
    narrow: false,
    tilt: { x: 0, y: 0, tx: 0, ty: 0 },
    written: { pose: [] as string[], z: [] as number[], sh: [] as number[], glow: [] as number[], ring: [] as string[], tilt: '' },
    didEnter: false,
    timers: new Set<number>(),
    skip: () => {},
  })

  useEffect(() => {
    const root = wrapRef.current
    const tiltEl = tiltRef.current
    if (!root || !tiltEl) return
    const s = st.current
    const w = s.written
    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => {
        s.timers.delete(t)
        fn()
      }, ms)
      s.timers.add(t)
    }

    const setZ = (i: number, z: number) => {
      if (w.z[i] === z) return
      const el = cardRefs.current[i]
      if (el) el.style.zIndex = String(z + 2)
      w.z[i] = z
    }
    const paintCard = (i: number, p: Pose, liftPx = 0) => {
      const el = cardRefs.current[i]
      if (!el) return
      const pose =
        `translate3d(calc(var(--card-w) * ${p.x.toFixed(4)}), calc(var(--card-w) * ${p.y.toFixed(4)} - ${liftPx.toFixed(2)}px), 0) ` +
        `rotate(${p.r.toFixed(2)}deg) scale(${p.s.toFixed(4)})`
      if (w.pose[i] !== pose) {
        el.style.transform = pose
        w.pose[i] = pose
      }
      const sh = Number(p.sh.toFixed(3))
      if (w.sh[i] !== sh) {
        el.style.setProperty('--shade', String(sh))
        w.sh[i] = sh
      }
    }
    const setGlow = (i: number, v: number) => {
      const o = Number(v.toFixed(3))
      if (w.glow[i] === o) return
      const el = glowRefs.current[i]
      if (el) el.style.opacity = String(o)
      w.glow[i] = o
    }
    const setRing = (j: number, x: number, y: number, sc: number, o: number) => {
      const el = ringRefs.current[j]
      if (!el) return
      const key = o <= 0 ? '0' : `${x.toFixed(4)}|${y.toFixed(4)}|${sc.toFixed(3)}|${o.toFixed(3)}`
      if (w.ring[j] === key) return
      w.ring[j] = key
      el.style.opacity = o <= 0 ? '0' : o.toFixed(3)
      if (o > 0) el.style.transform = `translate3d(calc(var(--card-w) * ${x.toFixed(4)}), calc(var(--card-w) * ${y.toFixed(4)}), 0) scale(${sc.toFixed(3)})`
    }

    if (reducedMotion()) {
      // The still fan: no cycle, no tilt.
      const narrow = root.clientWidth < 480
      for (let i = 0; i < N; i++) {
        setZ(i, i)
        paintCard(i, fanPose(i, narrow))
      }
      root.dataset.phase = 'fan'
      setEntered(true)
      return
    }

    const go = (phase: Phase) => {
      // A skip in the middle of a deal keeps only the deals that already
      // passed their far point (that card is behind the pile by then).
      if (s.phase === 'deal') {
        const t = s.clock - s.phaseAt
        const done = DEAL_AT.filter((at) => t - at >= DEAL_MS / 2).length
        s.layer = [...s.deal[done]]
      }
      s.phase = phase
      s.phaseAt = s.clock
      root.dataset.phase = phase
      s.from = s.now.map((p) => ({ ...p }))
      s.narrow = root.clientWidth < 480
      for (let i = 0; i < N; i++) setZ(i, s.layer[i])
      if (phase === 'deal') {
        // Twice: the top card goes to the back and the others move up one place.
        let layers = [...s.layer]
        s.deal[0] = layers
        for (let d = 0; d < 2; d++) {
          const top = layers.indexOf(N - 1)
          s.dealt[d] = top
          layers = layers.map((k, i) => (i === top ? 0 : k + 1))
          s.deal[d + 1] = layers
        }
      }
      if (phase === 'stack') {
        // One soft sheen across the top card.
        const top = s.layer.indexOf(N - 1)
        later(() => {
          const el = cardRefs.current[top]
          if (s.phase !== 'stack' || !el || el.classList.contains('is-sheen')) return
          el.classList.add('is-sheen')
          later(() => el.classList.remove('is-sheen'), 1400)
        }, 300)
      }
    }
    s.skip = () => go(NEXT[s.phase])

    let raf = 0
    let last = 0
    let inView = false

    const frame = (nowMs: number) => {
      raf = 0
      const dt = last ? Math.min(64, nowMs - last) : 16
      last = nowMs
      s.clock += dt
      const t = s.clock - s.phaseAt
      const settle = ease(unit(t / SETTLE_MS))
      const tap = s.phase === 'tap'

      for (let i = 0; i < N; i++) {
        const k = s.layer[i]
        let p: Pose
        let lift = 0
        switch (s.phase) {
          case 'stack': {
            // A gentle rise and fall over the hold, zero at both ends.
            const target = stackPose(k)
            target.y -= 0.008 * Math.sin(Math.PI * unit(t / TEAMS_CYCLE.stack))
            p = mix(s.from[i], target, settle)
            break
          }
          case 'deal': {
            const e0 = easeInOut(unit((t - DEAL_AT[0]) / DEAL_MS))
            const e1 = easeInOut(unit((t - DEAL_AT[1]) / DEAL_MS))
            p = mix(mix(s.from[i], stackPose(s.deal[1][i]), e0), stackPose(s.deal[2][i]), e1)
            for (let d = 0; d < 2; d++) {
              const e = d ? e1 : e0
              const arc = Math.sin(Math.PI * e)
              if (i === s.dealt[d]) {
                // Out to the right, then round the back of the pile.
                p.x += DEAL_OUT * arc
                p.y += DEAL_DIP * Math.sin(2 * Math.PI * e)
                p.r += DEAL_TURN * arc
                p.s *= 1 - (1 - DEAL_SCALE) * arc
              } else {
                p.x -= PILE_SHIFT * arc
              }
            }
            // The dealt card drops behind the pile at the far point of its trip.
            setZ(i, t < DEAL_AT[0] + DEAL_MS / 2 ? s.deal[0][i] : t < DEAL_AT[1] + DEAL_MS / 2 ? s.deal[1][i] : s.deal[2][i])
            break
          }
          case 'fan':
            p = mix(s.from[i], fanPose(k, s.narrow), ease(unit((t - k * FAN_STAGGER) / FAN_FLIGHT)))
            break
          case 'tap': {
            const c = fanPose(k, s.narrow)
            p = mix(s.from[i], c, settle)
            // The pulse reaches the cards left to right (fan slot = layer).
            const at = WAVE_START + k * WAVE_STEP
            lift = RISE_PX * bump(t, at, RISE_MS)
            setGlow(i, bump(t, at, GLOW_MS))
            for (let r = 0; r < 2; r++) {
              const u = (t - at - r * RIPPLE_GAP) / RIPPLE_MS
              const o = u <= 0 || u >= 1 ? 0 : u < 0.15 ? (0.5 * u) / 0.15 : 0.5 * (1 - (u - 0.15) / 0.85)
              setRing(i * 2 + r, c.x, c.y, 0.55 + 0.75 * ease(unit(u)), o)
            }
            break
          }
          default:
            // Gather: bottom card first, the top card lands last.
            p = mix(s.from[i], stackPose(k), ease(unit((t - k * GATHER_STAGGER) / GATHER_FLIGHT)))
            break
        }
        s.now[i] = p
        paintCard(i, p, lift)
        if (!tap) setGlow(i, 0)
      }
      if (!tap) for (let j = 0; j < N * 2; j++) setRing(j, 0, 0, 1, 0)
      if (t >= TEAMS_CYCLE[s.phase]) go(NEXT[s.phase])

      // The lean toward the pointer, eased.
      const tl = s.tilt
      const k2 = 1 - Math.exp(-dt / 220)
      tl.x += (tl.tx - tl.x) * k2
      tl.y += (tl.ty - tl.y) * k2
      const tilt = Math.abs(tl.x) < 0.01 && Math.abs(tl.y) < 0.01 ? 'none' : `perspective(900px) rotateX(${tl.x.toFixed(2)}deg) rotateY(${tl.y.toFixed(2)}deg)`
      if (w.tilt !== tilt) {
        tiltEl.style.transform = tilt
        w.tilt = tilt
      }

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
          go('stack')
        }
        if (inView) start()
        else stop()
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    io.observe(root)
    const onVis = () => (document.hidden ? stop() : start())
    document.addEventListener('visibilitychange', onVis)
    for (let i = 0; i < N; i++) {
      setZ(i, i)
      paintCard(i, stackPose(i)) // the pile, until the section scrolls into view
    }

    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      stop()
      s.timers.forEach((t) => window.clearTimeout(t))
      s.timers.clear()
    }
  }, [])

  // Desktop: the cards lean a little toward the pointer.
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || reducedMotion()) return
    const r = e.currentTarget.getBoundingClientRect()
    st.current.tilt.ty = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1) * TILT_MAX
    st.current.tilt.tx = -clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1) * TILT_MAX
  }
  const onPointerLeave = () => {
    st.current.tilt.tx = 0
    st.current.tilt.ty = 0
  }

  return (
    <div
      className={`teams__visual${entered ? ' is-in' : ''}`}
      ref={wrapRef}
      aria-hidden="true"
      onClick={() => !reducedMotion() && st.current.skip()}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <span className="teams__circle" />
      <div className="fan">
        <div className="fan__tilt" ref={tiltRef}>
          {Array.from({ length: N }, (_, i) => (
            <div className="fan__card" key={i} ref={(el) => void (cardRefs.current[i] = el)}>
              <div className="pcard pcard--light fan__face">
                <div className="pcard__face">
                  <span className="fan__glow" ref={(el) => void (glowRefs.current[i] = el)}>
                    <i />
                  </span>
                  <BrandMark variant="symbol" className="fan__symbol" />
                  <span className="pcard__gloss" />
                  <span className="fan__shade" />
                </div>
              </div>
            </div>
          ))}
          {Array.from({ length: N * 2 }, (_, j) => (
            <i className="fan__ring" key={j} ref={(el) => void (ringRefs.current[j] = el)} />
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

        <CardFan />
      </div>
    </section>
  )
}
