import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import '../intro.css'
import { ProductCard } from './ProductCard'
import {
  INTRO_SHOULD_PLAY,
  INTRO_T,
  INTRO_TEXT,
  TYPING_SCRIPT,
  releasePage,
  setPageInert,
  useIntroTimeline,
} from '../hooks/useIntro'
import type { Cue, Finger, Keystroke, Side } from '../hooks/useIntro'
import { getIntroAudio } from '../hooks/introAudio'
import type { IntroAudio } from '../hooks/introAudio'

/*
 * Opening sequence, played once per session before the hero.
 * Self-contained: delete this file, intro.css, hooks/useIntro.ts,
 * hooks/introAudio.ts and the <IntroSequence /> line in App.tsx to remove it.
 *
 * Copy is limited to confirmed brand lines: "Meet. Tap. Continue." and
 * "Make the first hello go further."
 */

// ---------------------------------------------------------------- keyboard
// QWERTY, positioned in key units (1 = one key pitch) across 11.5 units, with
// the real row stagger (A is 0.25 right of Q, Z is 0.75 right of Q).
type KeyDef = { id: string; label: string; x: number; w?: number }
const letters = (s: string, x0: number): KeyDef[] => [...s].map((c, i) => ({ id: c, label: c, x: x0 + i }))
const ROWS: KeyDef[][] = [
  letters('QWERTYUIOP', 0.5),
  [...letters('ASDFGHJKL', 0.75), { id: 'semi', label: ';', x: 9.75 }],
  [
    { id: 'shiftL', label: 'shift', x: 0, w: 1.25 },
    ...letters('ZXCVBNM', 1.25),
    { id: 'comma', label: ',', x: 8.25 },
    { id: 'dot', label: '.', x: 9.25 },
    { id: 'shiftR', label: 'shift', x: 10.25, w: 1.25 },
  ],
  [{ id: 'space', label: '', x: 3.25, w: 5 }],
]

// The words on screen, built from the same text the hands type.
const WORDS = INTRO_TEXT.split(' ').reduce<{ text: string; start: number }[]>((acc, text) => {
  const prev = acc[acc.length - 1]
  acc.push({ text, start: prev ? prev.start + prev.text.length + 1 : 0 })
  return acc
}, [])

const PHRASE = [
  { w: 'Make' }, { w: 'the' }, { w: 'first' }, { w: 'hello' },
  { w: 'go', accent: true }, { w: 'further.', accent: true },
]

// Timeline (ms): shared constants in hooks/useIntro.ts.
const T = INTRO_T

// ---------------------------------------------------------------- hands
// SVG units. Right hand; the left hand is mirrored about x = 54.
const VB = { x: -12, w: 132, h: 190 }
const TIPS: Record<Finger, [number, number]> = {
  index: [24, 24],
  middle: [46, 12],
  ring: [68, 20],
  pinky: [88, 40],
  thumb: [-4, 79],
}
const FINGER_RECTS: [Finger, number, number][] = [
  ['index', 24, 18],
  ['middle', 46, 6],
  ['ring', 68, 14],
  ['pinky', 88, 34],
]
const HAND_ANGLE = (-14 * Math.PI) / 180

function Hand({ side }: { side: Side }) {
  return (
    <div className={`intro-hand intro-hand--${side}`} data-hand={side}>
      <div className="intro-hand__dip">
        <svg viewBox={`${VB.x} 0 ${VB.w} ${VB.h}`} overflow="visible" aria-hidden="true">
          <g transform={side === 'left' ? 'translate(108 0) scale(-1 1)' : undefined}>
            <g data-finger="thumb">
              <rect x="-2" y="70" width="16" height="56" rx="8" transform="rotate(-28 6 98)" />
              <circle className="intro-hand__tip" data-tip="thumb" cx={TIPS.thumb[0]} cy={TIPS.thumb[1]} r="0.5" />
            </g>
            {FINGER_RECTS.map(([name, cx, top]) => (
              <g data-finger={name} key={name}>
                <rect x={cx - 8} y={top} width="16" height={104 - top} rx="8" />
                <circle className="intro-hand__tip" data-tip={name} cx={TIPS[name][0]} cy={TIPS[name][1]} r="0.5" />
              </g>
            ))}
            <rect className="intro-hand__palm" x="14" y="70" width="90" height="86" rx="28" />
            <rect className="intro-hand__cuff" x="16" y="146" width="86" height="48" rx="6" />
            <rect className="intro-hand__accent" x="16" y="151" width="86" height="5" />
          </g>
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- component
export function IntroSequence() {
  const [done, setDone] = useState(!INTRO_SHOULD_PLAY)
  if (done) return null
  return <IntroOverlay onDone={() => setDone(true)} />
}

function IntroOverlay({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const flyRef = useRef<HTMLDivElement>(null)
  const liveRef = useRef<HTMLParagraphElement>(null)
  const soundBtnRef = useRef<HTMLButtonElement>(null)
  // The page's one audio engine (module singleton): survives remounts, never closed.
  const audioRef = useRef<IntroAudio>(getIntroAudio())
  const [soundOn, setSoundOn] = useState(audioRef.current.enabled)
  // Sound is on but the browser hasn't let it play yet (no gesture so far).
  const [locked, setLocked] = useState(false)
  // Re-checks the audio state (pulse + gesture listeners); set on mount.
  const syncRef = useRef<() => void>(() => {})
  const finishedRef = useRef(false)
  const flewRef = useRef(false)

  // ---- finish / skip
  const finish = (skipped: boolean) => {
    if (finishedRef.current) return
    finishedRef.current = true
    stopRef.current()
    audioRef.current.suspend()

    const html = document.documentElement
    const root = rootRef.current
    const focusInside = !!root && root.contains(document.activeElement)
    const complete = () => {
      // Swap in one frame: hide the flown card as the hero's card appears.
      if (flyRef.current) flyRef.current.style.visibility = 'hidden'
      if (flewRef.current && !skipped) html.classList.add('intro-landed')
      releasePage()
      if (focusInside) {
        const main = document.querySelector<HTMLElement>('main')
        if (main) {
          main.setAttribute('tabindex', '-1')
          main.focus({ preventScroll: true })
        }
      }
      onDone()
    }

    if (skipped && root) {
      // Clean jump: stop everything in place, fade the overlay, start the hero.
      root.getAnimations({ subtree: true }).forEach((a) => a.pause())
      html.classList.remove('intro-playing', 'intro-flying')
      root.classList.add('is-skipping')
      window.setTimeout(complete, 320)
    } else {
      complete()
    }
  }

  // ---- the timeline
  const stopRef = useIntroTimeline(
    rootRef,
    () => {
      const root = rootRef.current!
      const stage = stageRef.current!
      const audio = audioRef.current!
      const cues: Cue[] = []
      const add = (at: number, run: () => void) => cues.push({ at, run })
      const phase = (at: number, name: string) => add(at, () => root.classList.add(name))

      const hands: Record<Side, HTMLElement> = {
        left: root.querySelector<HTMLElement>('[data-hand="left"]')!,
        right: root.querySelector<HTMLElement>('[data-hand="right"]')!,
      }
      const keyEl = (id: string) => root.querySelector<HTMLElement>(`[data-key="${id}"]`)!

      // Place a hand so the given fingertip sits over a key's centre. The hands
      // share the keyboard's container, so both are measured in the same frame
      // and the target holds even while the keyboard is still sliding in.
      // `.intro-key__c` is a zero-size point at the key cap's centre, so its box
      // is the exact on-screen centre under the 3D tilt.
      const placeHand = (side: Side, finger: Finger, key: string, duration: number) => {
        const hand = hands[side]
        const kr = keyEl(key).querySelector<HTMLElement>('.intro-key__c')!.getBoundingClientRect()
        const box = (hand.offsetParent as HTMLElement | null) ?? stage
        const sr = box.getBoundingClientRect()
        // On short desktop screens the stage is scaled down (--intro-fit):
        // screen px -> the container's own px. Exactly 1 everywhere else.
        const fit = box.offsetWidth ? sr.width / box.offsetWidth : 1
        const kx = (kr.left - sr.left) / fit
        const ky = (kr.top - sr.top) / fit
        const s = hand.offsetWidth / VB.w
        let [fx, fy] = TIPS[finger]
        if (side === 'left') fx = 108 - fx
        const px = (fx - VB.x) * s
        const py = fy * s
        const rx = px * Math.cos(HAND_ANGLE) - py * Math.sin(HAND_ANGLE)
        const ry = px * Math.sin(HAND_ANGLE) + py * Math.cos(HAND_ANGLE)
        hand.style.transitionDuration = `${duration}ms`
        hand.style.transform = `translate3d(${(kx - rx).toFixed(1)}px, ${(ky - ry).toFixed(1)}px, 0) rotate(${HAND_ANGLE}rad)`
        if (duration === 0) {
          // Cancel any move still in flight (same target or not) and jump to it.
          hand.style.transitionProperty = 'none'
          void hand.offsetWidth
          hand.style.transitionProperty = ''
        }
      }

      // One keystroke: everything fires from this single cue.
      let newest: HTMLElement | null = null
      const keyDown = (s: Keystroke) => {
        const hand = hands[s.side]
        // The hand has normally just arrived. If frames were dropped and it is
        // still travelling, finish the move now so the fingertip is on the key.
        placeHand(s.side, s.finger, s.key, 0)
        // Likewise if the hand's entrance is still running (slow first frames).
        hand
          .querySelector('.intro-hand__dip')
          ?.getAnimations()
          .forEach((a) => a instanceof CSSTransition && a.finish())
        hand.querySelector('.intro-hand__dip')?.animate(
          [{ transform: 'none' }, { transform: 'translateY(3%)' }, { transform: 'none' }],
          { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
        )
        hand.querySelector(`[data-finger="${s.finger}"]`)?.animate(
          [{ transform: 'none' }, { transform: 'translateY(4px)' }, { transform: 'none' }],
          { duration: 170, easing: 'ease-out' },
        )
        const k = keyEl(s.key)
        k.classList.add('is-down')
        k.dataset.downAt = String(s.at)
        audio.click(s.deep ? 0.78 : 1)
        if (s.index >= 0) {
          const ch = root.querySelector<HTMLElement>(`[data-ci="${s.index}"]`)
          if (ch) {
            newest?.classList.remove('is-new')
            ch.classList.add('is-in', 'is-new')
            ch.closest('.iw')?.classList.add('is-in')
            newest = ch
          }
        }
      }
      const keyUp = (s: Keystroke) => {
        const k = keyEl(s.key)
        // A later press of the same key owns it now.
        if (k.dataset.downAt === String(s.at)) k.classList.remove('is-down')
      }

      // Stage set-up
      add(0, () => {
        placeHand('left', 'index', 'F', 0)
        placeHand('right', 'index', 'J', 0)
        root.classList.add('is-on')
      })
      add(300, () => {
        if (liveRef.current) liveRef.current.textContent = 'Taply — make the first hello go further.'
      })
      phase(T.hands, 'is-hands')

      // Typing, from the shared script. A hand travels to its key just before
      // the press: once its last finger has lifted, and never while it is
      // holding Shift down.
      const freeAt: Record<Side, number> = { left: 0, right: 0 }
      TYPING_SCRIPT.forEach((s) => {
        const moveAt = Math.max(s.at - 110, freeAt[s.side])
        freeAt[s.side] = s.key.startsWith('shift') ? s.upAt + 10 : s.at + 40
        add(moveAt, () => placeHand(s.side, s.finger, s.key, Math.max(40, s.at - moveAt - 8)))
        add(s.at, () => keyDown(s))
        add(s.upAt, () => keyUp(s))
      })
      add(T.typed + 140, () => {
        placeHand('left', 'index', 'F', 260)
        placeHand('right', 'index', 'J', 260)
      })
      add(T.typed + 450, () => newest?.classList.remove('is-new'))

      // Keyboard and hands dissolve out on their own, then stop entirely.
      phase(T.dissolve, 'is-dissolve')
      add(T.gone, () => {
        root.classList.add('is-desk-gone')
        root.querySelector('.intro__desk')?.getAnimations({ subtree: true }).forEach((a) => a.cancel())
      })

      // Card
      add(T.rise, () => {
        root.classList.add('is-rise')
        audio.whoosh()
      })
      phase(T.tumble, 'is-tumble')
      phase(T.soften, 'is-soft')
      phase(T.zoom, 'is-zoom')
      add(T.sweep, () => {
        root.classList.add('is-sweep')
        audio.shimmer()
      })
      phase(T.phrase, 'is-phrase')

      // Handoff
      add(T.leave, () => {
        const html = document.documentElement
        const fly = flyRef.current
        const front = document.querySelector<HTMLElement>('.stage__card--front')
        const card = fly?.querySelector<HTMLElement>('.pcard')
        html.classList.add('intro-flying') // hero front card at rest (and hidden) for measuring
        let flew = false
        if (fly && front && card) {
          const r0 = card.getBoundingClientRect()
          const rt = front.getBoundingClientRect()
          const ct = { x: rt.left + rt.width / 2, y: rt.top + rt.height / 2 }
          const vw = window.innerWidth
          const vh = window.innerHeight
          const onScreen = ct.x > 0 && ct.x < vw && ct.y > vh * 0.12 && ct.y < vh * 0.88
          if (onScreen && r0.width > 0) {
            // The card layer may be scaled down (--intro-fit): screen px -> layer px.
            const layer = fly.parentElement
            const fit = layer && layer.offsetWidth ? layer.getBoundingClientRect().width / layer.offsetWidth : 1
            const dx = (ct.x - (r0.left + r0.width / 2)) / fit
            const dy = (ct.y - (r0.top + r0.height / 2)) / fit
            const k = front.offsetWidth / r0.width
            fly.animate(
              [{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(-9deg)` }],
              { duration: 950, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' },
            )
            flew = true
          }
        }
        flewRef.current = flew
        if (!flew) {
          html.classList.remove('intro-flying')
          root.classList.add('is-fade-card')
        }
        // The hero's own entrance starts as the overlay leaves.
        html.classList.remove('intro-playing')
        root.classList.add('is-leave')
      })
      add(T.done, () => finish(false))

      return cues
    },
    (hidden) => {
      // Back to visible: try again (a gesture unlocks it if this is refused).
      if (hidden) audioRef.current?.suspend()
      else audioRef.current?.resume()
    },
  )

  // ---- page state, gestures, Escape
  useEffect(() => {
    const html = document.documentElement
    html.classList.add('intro-mounted', 'intro-lock')
    if (!finishedRef.current) html.classList.add('intro-playing')
    setPageInert(true)

    // Audio, the same on every load (nothing about unlocking is stored).
    // Browsers block sound until a user activation. On iOS only touchend,
    // pointerup, click and keydown count (not touchstart or a touch
    // pointerdown), so only those unlock. The listeners stay registered (no
    // `once`: a scroll can't use them up) and every such event retries until
    // the context is confirmed 'running'; then they are removed, and they come
    // back if it drops out of 'running' later ('suspended', 'interrupted').
    const audio = audioRef.current
    const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const
    let listening = false
    const unlock = (e: Event) => {
      // The sound button handles its own tap (it may be turning sound off).
      if (soundBtnRef.current?.contains(e.target as Node)) return
      void audio.unlock(e.type)
    }
    const setGestures = (on: boolean) => {
      if (on === listening) return
      listening = on
      GESTURES.forEach((g) =>
        on
          ? window.addEventListener(g, unlock, { capture: true, passive: true })
          : window.removeEventListener(g, unlock, true),
      )
    }
    const sync = () => {
      const isLocked = audio.enabled && audio.supported && !audio.running
      setLocked(isLocked)
      setGestures(isLocked)
    }
    // Back-forward cache restore: the context comes back suspended.
    const onPageShow = () => {
      audio.resume()
      sync()
    }
    syncRef.current = sync
    audio.onStateChange(sync)
    audio.start()
    sync()
    window.addEventListener('pageshow', onPageShow)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish(true)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      audio.onStateChange(null)
      setGestures(false)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('keydown', onKey)
      if (!finishedRef.current) releasePage()
    }
    // Mount-only by design.
  }, [])

  const toggleSound = () => {
    const audio = audioRef.current
    if (!audio) return
    // On but still locked: this tap is what enables it, so unlock and stay on.
    if (soundOn && locked) {
      void audio.unlock('sound button')
      return
    }
    const next = !soundOn
    // Inside the button's own tap, so switching on also resumes and unlocks audio.
    audio.setEnabled(next)
    setSoundOn(next)
    syncRef.current()
  }

  return (
    <div className="intro" ref={rootRef} style={{ '--intro-dissolve': `${T.dissolveMs}ms` } as CSSProperties}>
      <p className="intro__sr" aria-live="polite" ref={liveRef} />

      <div className="intro__stage" ref={stageRef} aria-hidden="true">
        <span className="intro__grid" />
        {/* Everything on the stage moves together by --intro-offset (intro.css). */}
        <div className="intro__shift">
        <span className="intro__glow" />

        <p className="intro__words">
          {WORDS.map((w, i) => (
            <span className={`iw${i === WORDS.length - 1 ? ' iw--accent' : ''}`} data-word={i} key={w.text}>
              <span className="iw__bob" style={{ '--b': `${i * -0.7}s` } as CSSProperties}>
                {[...w.text].map((ch, j) => (
                  <span className="ic" data-ci={w.start + j} key={j}>
                    {ch}
                  </span>
                ))}
              </span>
            </span>
          ))}
        </p>

        <div className="intro__desk">
          <div className="intro-kb-wrap">
            <span className="intro-kb__shadow" />
            <div className="intro-kb">
              {ROWS.map((row, r) => (
                <div className="intro-kb__row" key={r}>
                  {row.map((k) => (
                    <span
                      className={`intro-key${k.w ? ' intro-key--wide' : ''}`}
                      data-key={k.id}
                      key={k.id}
                      style={{ '--x': k.x, '--w': k.w ?? 1 } as CSSProperties}
                    >
                      <span className="intro-key__cap">
                        <span className="intro-key__glow" />
                        <span className="intro-key__legend">{k.label}</span>
                        <i className="intro-key__c" />
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <Hand side="left" />
            <Hand side="right" />
          </div>
        </div>

        <p className="intro__phrase">
          {PHRASE.map((p, i) => (
            <span key={p.w}>
              {i > 0 && ' '}
              <span className={`ip${p.accent ? ' ip--accent' : ''}`}>
                <span className="ip__in" style={{ '--w': i } as CSSProperties}>
                  {p.w}
                </span>
              </span>
            </span>
          ))}
        </p>
        </div>
      </div>

      <div className="intro__card-layer" aria-hidden="true">
        <div className="intro__card-fly" ref={flyRef}>
          <div className="intro__card-zoom">
            <div className="intro__card-rise">
              <div className="intro__card-tumble">
                <div className="intro__card-front">
                  <ProductCard variant="dark" />
                  <span className="intro__sheen">
                    <i />
                  </span>
                  <span className="intro__nfc-flash" />
                </div>
                <div className="intro__card-back" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="intro__controls">
        <button
          type="button"
          ref={soundBtnRef}
          className={`intro__btn${locked ? ' is-locked' : ''}`}
          aria-pressed={soundOn}
          aria-label={locked ? 'Sound: tap to enable' : 'Sound'}
          title={locked ? 'Tap to enable sound' : soundOn ? 'Sound on' : 'Sound off'}
          onClick={toggleSound}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
            {soundOn ? (
              <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.2 5.2a6.6 6.6 0 0 1 0 9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            ) : (
              <path d="m13 7.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            )}
          </svg>
          <span>{soundOn ? 'Sound on' : 'Sound off'}</span>
        </button>
        <button type="button" className="intro__btn intro__btn--skip" onClick={() => finish(true)}>
          Skip
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3l5 4-5 4M10 3v8" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
