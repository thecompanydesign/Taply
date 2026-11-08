import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/*
 * Timing and page-state helpers for the opening sequence (IntroSequence).
 *
 * The play/no-play decision runs once, when this module is first imported,
 * which is before React's first render, so the hero's entrance can be held
 * back without a flash. Nothing here runs unless JS is working, so without JS
 * the site is simply the hero.
 */

const PAGE_SELECTOR = '.skip-link, .nav-wrap, main, footer'

/**
 * The intro plays on every load of the home page: every refresh, return visit
 * and deep link (#faq etc.). Nothing is remembered between loads. It doesn't
 * play on the onboarding form, with reduced motion, or with ?intro=0 (a test
 * switch). The same rule runs inline in index.html before the first paint.
 */
function decide(): boolean {
  if (typeof window === 'undefined') return false
  // Note: runs before main.tsx adds `.js` (imports evaluate first); JS is
  // running by definition here.
  if (window.location.pathname.startsWith('/onboard')) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  if (new URLSearchParams(window.location.search).get('intro') === '0') return false
  return true
}

export const INTRO_SHOULD_PLAY = decide()

export function setPageInert(on: boolean) {
  document.querySelectorAll<HTMLElement>(PAGE_SELECTOR).forEach((el) => {
    if (on) el.setAttribute('inert', '')
    else el.removeAttribute('inert')
  })
}

const toTop = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })

/**
 * Releases everything the intro holds: scroll lock, inert page, paused hero.
 * The page is shown from the top, and a #hash from the URL is dropped
 * (replaceState: no jump, no history entry) rather than scrolled to.
 */
export function releasePage() {
  toTop()
  if (window.location.hash) history.replaceState(history.state, '', window.location.pathname + window.location.search)
  document.documentElement.classList.remove('intro-playing', 'intro-lock', 'intro-flying', 'intro-gutter', 'boot')
  setPageInert(false)
}

/** Width of a classic (space-taking) scrollbar; 0 for overlay scrollbars. */
function scrollbarWidth(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(probe)
  const w = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return w
}

if (INTRO_SHOULD_PLAY) {
  toTop()
  // A #hash makes the browser scroll to it as the page loads: undo that
  // behind the overlay, so the intro always ends with the page at the top.
  window.addEventListener('load', () => document.documentElement.classList.contains('intro-lock') && toTop(), { once: true })
  // Reserve the scrollbar's space during the lock only where scrollbars take
  // space, so releasing the lock never shifts the layout.
  if (scrollbarWidth() > 0) document.documentElement.classList.add('intro-gutter')
  document.documentElement.classList.add('intro-playing', 'intro-lock')
  // Failsafe: if the overlay never mounts (render error), give the page back.
  window.setTimeout(() => {
    if (!document.documentElement.classList.contains('intro-mounted')) releasePage()
  }, 4000)
}

/*
 * The typing script: INTRO_TEXT split into keystrokes, each with one time.
 * IntroSequence fires everything for a keystroke from that single cue (key
 * depression, finger tap, click and the character appearing), so they can
 * never drift apart. Capitals press the opposite hand's Shift first.
 */
export const INTRO_TEXT = 'Meet. Tap. Continue.'

export type Side = 'left' | 'right'
export type Finger = 'index' | 'middle' | 'ring' | 'pinky' | 'thumb'

/** Touch-typing finger assignment: key id -> [hand, finger]. */
export const FINGER_FOR: Record<string, [Side, Finger]> = {}
;(
  [
    ['left', 'pinky', ['Q', 'A', 'Z', 'shiftL']],
    ['left', 'ring', ['W', 'S', 'X']],
    ['left', 'middle', ['E', 'D', 'C']],
    ['left', 'index', ['R', 'T', 'F', 'G', 'V', 'B']],
    ['right', 'index', ['Y', 'U', 'H', 'J', 'N', 'M']],
    ['right', 'middle', ['I', 'K', 'comma']],
    ['right', 'ring', ['O', 'L', 'dot']],
    ['right', 'pinky', ['P', 'semi', 'shiftR']],
  ] as [Side, Finger, string[]][]
).forEach(([side, finger, keys]) => keys.forEach((k) => (FINGER_FOR[k] = [side, finger])))

export function keyIdFor(ch: string): string {
  if (ch === '.') return 'dot'
  if (ch === ',') return 'comma'
  if (ch === ';') return 'semi'
  if (ch === ' ') return 'space'
  return ch.toUpperCase()
}

export type Keystroke = {
  /** Key goes down: depression, finger tap, click and character all fire here. */
  at: number
  /** Key comes back up. */
  upAt: number
  key: string
  side: Side
  finger: Finger
  /** Index of the character it types in INTRO_TEXT; -1 for Shift. */
  index: number
  /** Shift and the space bar sound slightly deeper. */
  deep: boolean
}

const TYPE_START = 640 // first letter
const KEY_GAP = 130 // ms between keystrokes, varied by JITTER: 110-150ms
const JITTER = [0, 10, -12, 15, -6, 8, -15, 4, 18, -10, 12, -4, -14, 9, -8, 16, -18, 6, 11, -5]
const AFTER_PERIOD = 100 // extra pause after a full stop
const AFTER_SPACE = 70 // extra pause after a space
const SHIFT_LEAD = 95 // Shift goes down this long before its letter
const SHIFT_AFTER = 50 // and is released this long after it
const TAP_HOLD = 80 // how long a tapped key stays down

function buildScript(text: string): Keystroke[] {
  const strokes: Keystroke[] = []
  let t = TYPE_START
  ;[...text].forEach((ch, i) => {
    if (i > 0) {
      const prev = text[i - 1]
      t += KEY_GAP + JITTER[i % JITTER.length] + (prev === '.' ? AFTER_PERIOD : 0) + (prev === ' ' ? AFTER_SPACE : 0)
    }
    const key = keyIdFor(ch)
    let side: Side
    let finger: Finger
    if (ch === ' ') {
      // Space with a thumb. If the next letter is a capital, use the thumb of
      // the hand that types it, so the other hand is free for Shift.
      const next = text[i + 1]
      side = next && next !== next.toLowerCase() ? FINGER_FOR[keyIdFor(next)][0] : 'right'
      finger = 'thumb'
    } else {
      ;[side, finger] = FINGER_FOR[key]
    }
    if (ch !== ch.toLowerCase()) {
      const shiftSide: Side = side === 'left' ? 'right' : 'left'
      strokes.push({
        at: t - SHIFT_LEAD,
        upAt: t + SHIFT_AFTER,
        key: shiftSide === 'left' ? 'shiftL' : 'shiftR',
        side: shiftSide,
        finger: 'pinky',
        index: -1,
        deep: true,
      })
    }
    strokes.push({ at: t, upAt: t + TAP_HOLD, key, side, finger, index: i, deep: ch === ' ' })
  })
  return strokes.sort((a, b) => a.at - b.at)
}

export const TYPING_SCRIPT = buildScript(INTRO_TEXT)

/*
 * The single source of truth for the sequence's stage timings (ms from start).
 * Each stage starts from the end of the one before, so the keyboard and hands
 * are fully gone before the card enters, and everything after the card's rise
 * keeps its original spacing. IntroSequence schedules its cues from this, and
 * passes the dissolve duration to intro.css as `--intro-dissolve`.
 */
const TYPED = TYPING_SCRIPT[TYPING_SCRIPT.length - 1].at // last key press ("Continue." lands)
const DISSOLVE_AT = TYPED + 180 // after the final key's press-and-spring settles
const DISSOLVE_MS = 600
const CARD_GAP = 120 // breath between the keyboard leaving and the card arriving
const RISE = DISSOLVE_AT + DISSOLVE_MS + CARD_GAP

export const INTRO_T = {
  hands: 150,
  typed: TYPED,
  dissolve: DISSOLVE_AT,
  dissolveMs: DISSOLVE_MS,
  gone: DISSOLVE_AT + DISSOLVE_MS,
  // Card and everything after keep their original offsets from the rise.
  rise: RISE,
  tumble: RISE + 750,
  soften: RISE + 1400,
  zoom: RISE + 1450,
  sweep: RISE + 1550,
  phrase: RISE + 2000,
  leave: RISE + 3100,
  done: RISE + 4100,
} as const

export type Cue = { at: number; run: () => void }

/**
 * Runs cues against a clock that only advances while the tab is visible.
 * While hidden it also pauses every CSS/WAAPI animation inside `rootRef`
 * (and resumes only those it paused), and calls `onHidden` for audio.
 */
export function useIntroTimeline(
  rootRef: RefObject<HTMLElement | null>,
  buildCues: () => Cue[],
  onHidden?: (hidden: boolean) => void,
) {
  const stopRef = useRef<() => void>(() => {})

  useEffect(() => {
    const cues = buildCues().sort((a, b) => a.at - b.at)
    let i = 0
    let elapsed = 0
    let last = 0
    let raf = 0
    let stopped = false
    let paused: Animation[] = []

    const tick = (now: number) => {
      elapsed += now - last
      last = now
      while (i < cues.length && cues[i].at <= elapsed) cues[i++].run()
      if (!stopped && i < cues.length) raf = requestAnimationFrame(tick)
    }
    const start = (now: number) => {
      last = now
      tick(now)
    }
    raf = requestAnimationFrame(start)

    const onVisibility = () => {
      if (stopped) return
      if (document.hidden) {
        cancelAnimationFrame(raf)
        paused = (rootRef.current?.getAnimations({ subtree: true }) ?? []).filter((a) => a.playState === 'running')
        paused.forEach((a) => a.pause())
      } else {
        paused.forEach((a) => a.play())
        paused = []
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(start)
      }
      onHidden?.(document.hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)

    const stop = () => {
      stopped = true
      cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    stopRef.current = stop
    return stop
    // The cue list is built once per mount by design.
  }, [])

  return stopRef
}
