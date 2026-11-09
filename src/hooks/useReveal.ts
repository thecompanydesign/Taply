import { useEffect } from 'react'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Scroll reveals.
 *  - `.reveal`  : the element itself fades/slides in.
 *  - `.stagger` : its direct children reveal one after another (index in `--i`).
 *  - `.trigger` : gets `.in` only; descendants define their own entrance.
 * Elements already scrolled past (e.g. after a mid-page reload) are revealed
 * immediately so content can never stay hidden.
 *
 * Also marks <html> with `fx-ready`; main.tsx removes the `.js` guard if that
 * never happens, so a failed script can't leave content hidden.
 */
export function useReveal() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('fx-ready')

    document.querySelectorAll<HTMLElement>('.stagger').forEach((el) => {
      Array.from(el.children).forEach((child, i) => (child as HTMLElement).style.setProperty('--i', String(i)))
    })

    const els = Array.from(document.querySelectorAll<HTMLElement>('.reveal, .stagger, .trigger'))
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.boundingClientRect.top < 0) {
            entry.target.classList.add('in')
            io.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    )
    els.forEach((el) => io.observe(el))

    // An element can jump from below the screen to above it between two
    // frames (a fast fling, an anchor jump). The observer never fires then,
    // because it was "not intersecting" before and after, so on scroll
    // (passive, once per frame) anything already above the reveal line is
    // revealed too. Reads first, then writes; stops once all are revealed.
    let frame = 0
    const sweep = () => {
      frame = 0
      const pending = els.filter((el) => !el.classList.contains('in'))
      if (!pending.length) return window.removeEventListener('scroll', onScroll)
      const line = window.innerHeight * 0.88
      const due = pending.filter((el) => el.getBoundingClientRect().top < line)
      due.forEach((el) => {
        el.classList.add('in')
        io.unobserve(el)
      })
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sweep)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
}

/**
 * Looping animations only run while their section is on screen and the tab is
 * visible. Sections opt in with `data-loop`; CSS pauses the loops otherwise.
 */
export function useLoopVisibility() {
  useEffect(() => {
    const root = document.documentElement
    const onVis = () => root.classList.toggle('tab-hidden', document.hidden)
    onVis()
    document.addEventListener('visibilitychange', onVis)

    const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-loop]'))
    let io: IntersectionObserver | undefined
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        for (const e of entries) e.target.classList.toggle('is-playing', e.isIntersecting)
      })
      sections.forEach((s) => io!.observe(s))
    } else {
      sections.forEach((s) => s.classList.add('is-playing'))
    }
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      io?.disconnect()
    }
  }, [])
}

/**
 * Scroll-linked effects, one rAF per frame and only for elements on screen:
 *  - `[data-parallax="0.06"]` moves vertically against the scroll (via the CSS
 *    `translate` property, so it composes with any existing `transform`).
 *    Measured from the parent, so the element's own offset never feeds back.
 *  - `.eyebrow__rule` fills (scaleX via `--fill`) as its section scrolls in.
 * Off for reduced motion; parallax is also off on touch / small screens.
 */
export function useScrollFx() {
  useEffect(() => {
    if (reducedMotion()) return
    const parallaxOn = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 821px)').matches

    const parallax = parallaxOn ? Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]')) : []
    const rules = Array.from(document.querySelectorAll<HTMLElement>('.eyebrow__rule'))
    const visible = new Set<HTMLElement>()

    let frame = 0
    const update = () => {
      frame = 0
      const vh = window.innerHeight
      const reads: [HTMLElement, number, number][] = []
      for (const el of visible) {
        const target = el.dataset.parallax !== undefined ? el.parentElement ?? el : el
        const r = target.getBoundingClientRect()
        reads.push([el, r.top, r.height])
      }
      for (const [el, top, height] of reads) {
        if (el.dataset.parallax !== undefined) {
          const speed = parseFloat(el.dataset.parallax) || 0.06
          const offset = top + height / 2 - vh / 2
          el.style.setProperty('--py', `${(-offset * speed).toFixed(1)}px`)
        } else {
          const fill = Math.min(1, Math.max(0, (vh * 0.92 - top) / (vh * 0.35)))
          el.style.setProperty('--fill', fill.toFixed(3))
        }
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement
          // Layer hint only while a parallax element is near the screen.
          if (el.dataset.parallax !== undefined) el.style.willChange = e.isIntersecting ? 'translate' : ''
          if (e.isIntersecting) visible.add(el)
          else visible.delete(el)
        }
        schedule()
      },
      { rootMargin: '15% 0px' },
    )
    ;[...parallax, ...rules].forEach((el) => io.observe(el))

    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      io.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
      ;[...parallax, ...rules].forEach((el) => {
        el.style.removeProperty('--py')
        el.style.removeProperty('will-change')
        el.style.removeProperty('--fill')
      })
    }
  }, [])
}

/**
 * CTA float: a CTA lifts (`.is-lifted`) while it is comfortably in view and
 * settles back to flat when it leaves, every time. One shared observer; a
 * MutationObserver picks up CTAs added later (e.g. the onboarding
 * confirmation) and lets go of removed ones. Opted out: `data-float="off"`,
 * and anything in the hero, the navigation bar or the mobile menu (always on
 * screen). Floating CTAs get `.is-floating` for their slower transition.
 * Nothing at all with reduced motion: the buttons stay flat.
 */
const FLOAT_OFF = '[data-float="off"], .hero, .nav-wrap, .nav-panel'

export function useCtaFloat() {
  useEffect(() => {
    if (reducedMotion() || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.target.classList.toggle('is-lifted', e.isIntersecting && e.intersectionRatio >= 0.59)
      },
      { rootMargin: '-12% 0px -12% 0px', threshold: [0, 0.6] },
    )
    const watched = new Set<HTMLElement>()
    const ctasIn = (node: Node): HTMLElement[] => {
      if (!(node instanceof HTMLElement)) return []
      const found = Array.from(node.querySelectorAll<HTMLElement>('.cta'))
      return node.matches('.cta') ? [node, ...found] : found
    }
    const add = (node: Node) =>
      ctasIn(node).forEach((el) => {
        if (watched.has(el) || el.closest(FLOAT_OFF)) return
        watched.add(el)
        el.classList.add('is-floating')
        io.observe(el)
      })
    const drop = (node: Node) =>
      ctasIn(node).forEach((el) => {
        if (!watched.delete(el)) return
        io.unobserve(el)
        el.classList.remove('is-floating', 'is-lifted')
      })

    add(document.body)
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.removedNodes.forEach(drop)
        r.addedNodes.forEach(add)
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      io.disconnect()
      watched.forEach((el) => el.classList.remove('is-floating', 'is-lifted'))
    }
  }, [])
}

/**
 * Magnetic pull (max 4px) on the primary CTAs. Fine pointers only, never with
 * reduced motion. Uses the `translate` property so hover lifts still apply.
 */
export function useMagnetic() {
  useEffect(() => {
    if (reducedMotion()) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const MAX = 4
    let active: HTMLElement | null = null
    let frame = 0
    let pending: { x: number; y: number } | null = null

    const release = () => {
      if (active) active.style.translate = ''
      active = null
    }
    const apply = () => {
      frame = 0
      if (!active || !pending) return
      const r = active.getBoundingClientRect()
      let dx = (pending.x - (r.left + r.width / 2)) / (r.width / 2)
      let dy = (pending.y - (r.top + r.height / 2)) / (r.height / 2)
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        dx /= len
        dy /= len
      }
      active.style.translate = `${(dx * MAX).toFixed(2)}px ${(dy * MAX).toFixed(2)}px`
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest<HTMLElement>('.cta--violet, .cta--lime, .cta--white')
      if (el !== active) release()
      if (!el) return
      active = el
      pending = { x: e.clientX, y: e.clientY }
      if (!frame) frame = requestAnimationFrame(apply)
    }

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', release)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', release)
      if (frame) cancelAnimationFrame(frame)
      release()
    }
  }, [])
}
