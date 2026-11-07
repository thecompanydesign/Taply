import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FocusEvent, FormEvent, ReactNode, RefObject } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, ORDER_URL, WHATSAPP_NUMBER } from '../components/shared'
import { CardBody, CardStage, FlipButton, StaticCards, usePrefersReducedMotion } from '../components/YourCardSection'
import { EMPTY_BRIEF, MAX, MAX_CARD_FILES, MAX_SOCIALS, MAX_TOTAL_BYTES, PLATFORMS, validateBrief } from './limits'
import type { Brief, FieldErrors, Platform, Social } from './limits'
import { formatBytes, kindList, prepare, SLOT_ACCEPT, SLOT_LABEL } from './files'
import type { Prepared, Slot } from './files'
import './onboard.css'

/*
 * Private client onboarding form (/onboard?t=<signed token>).
 * Not linked from the public site; noindex. The token is checked by
 * /api/verify before the form renders, and again by /api/submit.
 * One scrolling page: every section is visible, one submit button.
 */

const wa = (text: string) => `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`
const LINK_HELP = wa("Hi Taply! My form link isn't working. Kindly send a new one.")
const SETUP_HELP = wa("Hi Taply! I tried to send my card details through the form, but it isn't set up yet. Can you help?")
const REDUCED = '(prefers-reduced-motion: reduce)'

/** `key` keeps an unsent draft per link in this browser: "universal", or an older per-client link's ID. */
type Link = { key: string }
/** What the confirmation page's draft card shows: the submitted values and the local file URLs. */
type Draft = { name: string; title: string; company: string; tagline: string; logoUrl?: string; photoUrl?: string; urls: string[] }
/** `ref` is the reference the server created for this submission. */
type Done = { dev: boolean; ref: string; firstName: string; draft: Draft }
type Screen =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'not-configured' }
  | { kind: 'form'; link: Link }
  | ({ kind: 'success' } & Done)

/** First word of the full name, capitalised: "kim otieno" and "KIM OTIENO" give "Kim"; "McKenzie" stays as typed. */
function firstNameOf(full: string): string {
  const word = full.trim().split(/\s+/)[0] ?? ''
  if (!word) return ''
  const mixed = word !== word.toLowerCase() && word !== word.toUpperCase()
  if (mixed) return word.charAt(0).toUpperCase() + word.slice(1)
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

type Files = Record<Slot, Prepared[]>
const NO_FILES: Files = { logo: [], photo: [], card: [] }
/** The fields that must be valid before the button looks ready. */
const REQUIRED_KEYS = ['ordererName', 'ordererPhone', 'name', 'phone', 'consent']

/** Which field shows which side of the preview card. */
const BACK_FIELDS = new Set(['name', 'title', 'company', 'photo'])
const FRONT_FIELDS = new Set(['tagline', 'logo'])

// ---------------------------------------------------------------- storage (drafts)
const draftKey = (ref: string) => `taply-brief-draft-v2:${ref}`
function loadDraft(ref: string): Brief | null {
  try {
    const raw = window.localStorage.getItem(draftKey(ref))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Brief>
    const b: Brief = { ...EMPTY_BRIEF }
    for (const k of Object.keys(EMPTY_BRIEF) as (keyof Brief)[]) {
      const v = d[k]
      if (typeof v === typeof EMPTY_BRIEF[k] && !Array.isArray(EMPTY_BRIEF[k])) (b as Record<string, unknown>)[k] = v
    }
    b.socials = (Array.isArray(d.socials) ? d.socials : [])
      .filter((s): s is Social => !!s && typeof s.url === 'string' && (PLATFORMS as readonly string[]).includes(s.platform))
      .slice(0, MAX_SOCIALS)
    if (!b.socials.length) b.socials = [{ platform: 'LinkedIn', url: '' }]
    b.consent = false
    b.consentAt = ''
    return b
  } catch (e) {
    console.warn('[onboard] could not read the saved draft', e)
    return null
  }
}
function saveDraft(ref: string, b: Brief) {
  try {
    const { consent: _c, consentAt: _t, ...text } = b
    void _c
    void _t
    window.localStorage.setItem(draftKey(ref), JSON.stringify(text))
  } catch (e) {
    console.warn('[onboard] could not save the draft', e)
  }
}
function clearDraft(ref: string) {
  try {
    window.localStorage.removeItem(draftKey(ref))
    window.localStorage.removeItem(startKey(ref))
  } catch (e) {
    console.warn('[onboard] could not clear the draft', e)
  }
}
/** When the visitor first opened this link: survives refreshes, so the minimum fill time counts from the first visit. */
const startKey = (ref: string) => `taply-brief-start:${ref}`
function firstOpened(ref: string): number {
  const now = Date.now()
  try {
    const saved = Number(window.localStorage.getItem(startKey(ref)))
    if (saved > 0 && saved <= now) return saved
    window.localStorage.setItem(startKey(ref), String(now))
  } catch (e) {
    console.warn('[onboard] could not read the start time', e)
  }
  return now
}

function useWide() {
  const q = '(min-width: 981px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setWide(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}

/** A light rise-in for each section as it enters the viewport (none with reduced motion). */
function useReveal(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el || !('IntersectionObserver' in window) || window.matchMedia(REDUCED).matches) return
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-reveal]'))
    items.forEach((s) => (s.dataset.reveal = 'pending'))
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((en) => {
          if (!en.isIntersecting) return
          ;(en.target as HTMLElement).dataset.reveal = 'in'
          io.unobserve(en.target)
        }),
      { rootMargin: '0px 0px -8% 0px' },
    )
    items.forEach((s) => io.observe(s))
    return () => {
      io.disconnect()
      items.forEach((s) => (s.dataset.reveal = 'in'))
    }
  }, [root])
}

// ---------------------------------------------------------------- page
export default function OnboardingPage() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('t'), [])
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' })

  useEffect(() => {
    if (!token) {
      setScreen({ kind: 'invalid' })
      return
    }
    let gone = false
    fetch(`/api/verify?t=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (gone) return
        if (r.ok && body.ok && typeof body.key === 'string') setScreen({ kind: 'form', link: { key: body.key } })
        else if (body.reason === 'not-configured') setScreen({ kind: 'not-configured' })
        else setScreen({ kind: 'invalid' })
      })
      .catch((e) => {
        console.warn('[onboard] verify failed', e)
        if (!gone) setScreen({ kind: 'invalid' })
      })
    return () => {
      gone = true
    }
  }, [token])

  return (
    <div className="ob">
      <span className="ob__grid" aria-hidden="true" />
      <header className="container ob-top">
        <BrandMark variant="logo" alt="Taply" className="ob-top__logo" />
      </header>
      <main className="container ob-main" id="main">
        {screen.kind === 'loading' && (
          <p className="ob-loading" role="status">
            Checking your link…
          </p>
        )}
        {screen.kind === 'invalid' && (
          <Notice title="This link isn't active." line="Please ask the Taply team for a new one." cta="Message Taply on WhatsApp" href={LINK_HELP} />
        )}
        {screen.kind === 'not-configured' && (
          <Notice
            title="The form isn't set up yet."
            line="Your details have not been sent. Please message us on WhatsApp and we'll help you directly."
            cta="Message Taply on WhatsApp"
            href={SETUP_HELP}
          />
        )}
        {screen.kind === 'form' && (
          <BriefForm
            link={screen.link}
            token={token!}
            onDone={(done) => setScreen({ kind: 'success', ...done })}
            onLinkInvalid={() => setScreen({ kind: 'invalid' })}
            onNotConfigured={() => setScreen({ kind: 'not-configured' })}
          />
        )}
        {screen.kind === 'success' && <Success refCode={screen.ref} dev={screen.dev} firstName={screen.firstName} draft={screen.draft} />}
      </main>
    </div>
  )
}

function Notice({ title, line, cta, href }: { title: string; line: string; cta: string; href: string }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <section className="ob-screen ob-fade">
      <h1 className="h2 ob-screen__title" tabIndex={-1} ref={ref}>
        {title}
      </h1>
      <p className="lede">{line}</p>
      <div className="ob-screen__cta">
        <CTA href={href} variant="violet" external srNote=" (opens WhatsApp in a new tab)">
          {cta}
        </CTA>
      </div>
    </section>
  )
}

function Success({ refCode, dev, firstName, draft }: { refCode: string; dev: boolean; firstName: string; draft: Draft }) {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    ref.current?.focus()
    window.scrollTo({ top: 0 })
  }, [])
  return (
    <section className="ob-screen ob-screen--done ob-fade" aria-labelledby="ob-done">
      {dev && <p className="ob-dev">DEV MODE: not emailed</p>}
      <p className="eyebrow">
        <span className="eyebrow__num">✓</span>
        <span>— Brief received</span>
        <span className="eyebrow__rule eyebrow__rule--violet" aria-hidden="true" />
      </p>
      <h1 className="h2 ob-screen__title" id="ob-done" tabIndex={-1} ref={ref}>
        Thank you{firstName ? `, ${firstName}` : ''}. <span className="accent">We're on it.</span>
      </h1>
      <p className="ob-ref">
        <span className="ob-ref__k">Reference</span>
        <span className="ob-ref__v">{refCode}</span>
      </p>
      <DraftCard draft={draft} />
      <h2 className="ob-next__title">What happens next</h2>
      <ol className="ob-next">
        <li>
          <span className="ob-next__n">01</span>
          <span>We design your digital profile and card mockup. Your digital profile is ready within hours.</span>
        </li>
        <li>
          <span className="ob-next__n">02</span>
          <span>You approve the mockup.</span>
        </li>
        <li>
          <span className="ob-next__n">03</span>
          <span>We print your card. Printing takes 2 days after you approve the mockup.</span>
        </li>
      </ol>
      <p className="ob-done__note">Once you have dashboard access, edit your vCard details anytime, as often as you like.</p>
      <div className="ob-screen__cta">
        <CTA href={wa(`Hi Taply! I have a question about my card brief (${refCode}).`)} variant="violet" external srNote=" (opens WhatsApp in a new tab)">
          Questions? Message us on WhatsApp
        </CTA>
      </div>
    </section>
  )
}

/**
 * The submitted values on the real card, from memory: the logo and photo are
 * the local object URLs the form already made (no network request). The URLs
 * are released when this page goes away.
 */
function DraftCard({ draft }: { draft: Draft }) {
  const reduced = usePrefersReducedMotion()
  const revokeTimer = useRef(0)
  useEffect(() => {
    // Deferred, so React's development double-mount doesn't release them early.
    window.clearTimeout(revokeTimer.current)
    return () => {
      revokeTimer.current = window.setTimeout(() => draft.urls.forEach((u) => URL.revokeObjectURL(u)), 0)
    }
  }, [draft])
  const front = { logoSrc: draft.logoUrl, tagline: draft.tagline, fallback: 'symbol' as const }
  const back = { name: draft.name, role: draft.title, company: draft.company, photoSrc: draft.photoUrl }
  const label = 'Draft preview of your card: the front and the back with your details and a QR code'
  return (
    <section className="ob-draft" aria-labelledby="ob-draft-title">
      <h2 className="ob-draft__title" id="ob-draft-title">
        Your card, so far
      </h2>
      <div className="ob-draft__card">{reduced ? <StaticCards front={front} back={back} label={label} /> : <CardStage front={front} back={back} label={label} />}</div>
      <p className="ob-draft__note">Draft preview. Our team will refine your final mockup and send it for your approval.</p>
    </section>
  )
}

// ---------------------------------------------------------------- form
type FormProps = {
  link: Link
  token: string
  onDone: (done: Done) => void
  onLinkInvalid: () => void
  onNotConfigured: () => void
}

function BriefForm({ link, token, onDone, onLinkInvalid, onNotConfigured }: FormProps) {
  const restored = useMemo(() => loadDraft(link.key), [link.key])
  const [brief, setBrief] = useState<Brief>(restored ?? { ...EMPTY_BRIEF, socials: [{ platform: 'LinkedIn', url: '' }] })
  const [files, setFiles] = useState<Files>(NO_FILES)
  const [fileErr, setFileErr] = useState<Partial<Record<Slot, string>>>({})
  const [errors, setErrors] = useState<FieldErrors>({})
  const [announce, setAnnounce] = useState(restored ? 'We restored the details you typed earlier.' : '')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [rateLimited, setRateLimited] = useState(false)
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [hp, setHp] = useState('')
  const startedAt = useRef(firstOpened(link.key))
  const formRef = useRef<HTMLFormElement>(null)
  const briefRef = useRef(brief)
  briefRef.current = brief
  const focusSocial = useRef<number | null>(null)
  const handedOff = useRef(false)
  const wide = useWide()
  useReveal(formRef)

  // Draft: typed text only (never files), saved shortly after each change.
  useEffect(() => {
    const id = window.setTimeout(() => saveDraft(link.key, brief), 400)
    return () => window.clearTimeout(id)
  }, [brief, link.key])

  // Object URLs for thumbnails are released when the form goes away, unless
  // the confirmation page took them over for its draft card.
  const filesRef = useRef(files)
  filesRef.current = files
  useEffect(
    () => () => {
      if (!handedOff.current) Object.values(filesRef.current).flat().forEach((f) => f.url && URL.revokeObjectURL(f.url))
    },
    [],
  )

  // A new social row gets focus once it exists.
  useEffect(() => {
    if (focusSocial.current === null) return
    formRef.current?.querySelector<HTMLElement>(`#f-social${focusSocial.current}url`)?.focus()
    focusSocial.current = null
  }, [brief.socials.length])

  const update = (next: Brief, changed: string) => {
    setBrief(next)
    // Errors appear on blur or submit only; typing just clears one that is fixed.
    if (errors[changed] && !validateBrief(next)[changed]) setErrors((e) => ({ ...e, [changed]: undefined }))
  }
  const set = <K extends keyof Brief>(k: K, v: Brief[K]) => update({ ...briefRef.current, [k]: v }, k)
  const blur = (k: string) => () => {
    const msg = validateBrief(briefRef.current)[k]
    setErrors((e) => (e[k] === msg ? e : { ...e, [k]: msg }))
  }
  /** value / onChange / onBlur for a text field. */
  const text = (k: keyof Brief) => ({
    value: brief[k] as string,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value as never),
    onBlur: blur(k),
  })

  const setSocial = (i: number, patch: Partial<Social>) =>
    update({ ...briefRef.current, socials: briefRef.current.socials.map((s, j) => (j === i ? { ...s, ...patch } : s)) }, `social${i}url`)
  const addSocial = () => {
    const used = new Set(brief.socials.map((s) => s.platform))
    const platform = PLATFORMS.find((p) => !used.has(p) && p !== 'Other') ?? 'Other'
    focusSocial.current = brief.socials.length
    set('socials', [...brief.socials, { platform, url: '' }])
  }
  const removeSocial = (i: number) => {
    set(
      'socials',
      brief.socials.filter((_, j) => j !== i),
    )
    // Row errors are keyed by position: recheck them on the next blur or submit.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith('social'))))
    setAnnounce(`Social link ${i + 1} removed.`)
    window.setTimeout(() => formRef.current?.querySelector<HTMLElement>('.ob-add--social')?.focus(), 0)
  }

  const totalBytes = Object.values(files).flat().reduce((n, f) => n + f.file.size, 0)

  // ---- files
  const addFiles = async (slot: Slot, list: FileList | File[]) => {
    const incoming = Array.from(list)
    if (!incoming.length) return
    const room = slot === 'card' ? MAX_CARD_FILES - files.card.length : 1
    if (room <= 0) {
      setFileErr((e) => ({ ...e, [slot]: 'You can upload up to 2 files here: the front and the back. Remove one to add another.' }))
      return
    }
    const take = incoming.slice(0, room)
    const problems: string[] = []
    if (incoming.length > room) problems.push(slot === 'card' ? 'Only 2 files fit here (front and back).' : 'Only one file fits here; we used the first.')
    const ok: Prepared[] = []
    for (const f of take) {
      try {
        ok.push(await prepare(f, slot))
      } catch (err) {
        problems.push((err as Error).message)
      }
    }
    setFiles((cur) => {
      if (slot !== 'card' && ok.length) cur[slot].forEach((p) => p.url && URL.revokeObjectURL(p.url))
      return { ...cur, [slot]: slot === 'card' ? [...cur.card, ...ok] : ok.length ? ok : cur[slot] }
    })
    setFileErr((e) => ({ ...e, [slot]: problems.join(' ') || undefined }))
    setAnnounce(problems.length ? problems.join(' ') : `${ok.map((p) => p.name).join(', ')} added to your ${SLOT_LABEL[slot]}.`)
    if (slot === 'logo' && ok.length) setSide('front')
    if (slot === 'photo' && ok.length) setSide('back')
  }
  const removeFile = (slot: Slot, id: string) => {
    setFiles((cur) => {
      cur[slot].filter((p) => p.id === id).forEach((p) => p.url && URL.revokeObjectURL(p.url))
      return { ...cur, [slot]: cur[slot].filter((p) => p.id !== id) }
    })
    setFileErr((e) => ({ ...e, [slot]: undefined }))
    setAnnounce(`File removed from your ${SLOT_LABEL[slot]}.`)
  }

  // Which file to shrink when everything together is over the limit.
  const totalError = useMemo(() => {
    if (totalBytes <= MAX_TOTAL_BYTES) return ''
    const biggest = Object.values(files)
      .flat()
      .sort((a, b) => b.file.size - a.file.size)[0]
    return `Your files add up to ${formatBytes(totalBytes)}, over the 4 MB limit. Please use a smaller ${SLOT_LABEL[biggest.slot]} ("${biggest.name}", ${formatBytes(biggest.file.size)}).`
  }, [files, totalBytes])
  const biggestSlot = totalError ? Object.values(files).flat().sort((a, b) => b.file.size - a.file.size)[0].slot : null

  const live = validateBrief(brief)
  const ready = !REQUIRED_KEYS.some((k) => live[k])

  const focusFirstInvalid = () =>
    window.setTimeout(() => {
      const el = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      if (!el) return
      el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia(REDUCED).matches ? 'auto' : 'smooth' })
    }, 30)

  // ---- submit
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (sending) return
    const found = validateBrief(brief)
    setErrors(found)
    const n = Object.keys(found).length + (totalError ? 1 : 0)
    if (n) {
      setAnnounce(`Please check ${n} ${n === 1 ? 'field' : 'fields'} before you send.`)
      focusFirstInvalid()
      return
    }
    setSending(true)
    setSendError('')
    setRateLimited(false)
    setAnnounce('Sending your details…')
    const payload: Brief = {
      ...brief,
      ordererName: brief.gift ? brief.ordererName : '',
      ordererPhone: brief.gift ? brief.ordererPhone : '',
      socials: brief.socials.filter((s) => s.url.trim()),
    }
    const fd = new FormData()
    fd.append('brief', JSON.stringify(payload))
    fd.append('elapsed', String(Math.round((Date.now() - startedAt.current) / 1000)))
    fd.append('fax', hp)
    for (const p of [...files.logo, ...files.photo, ...files.card]) fd.append(p.slot, p.file, p.file.name)
    try {
      const r = await fetch('/api/submit', { method: 'POST', headers: { 'x-taply-token': token }, body: fd })
      const body = await r.json().catch(() => ({}))
      if (r.ok && body.ok) {
        clearDraft(link.key)
        handedOff.current = true
        const all = Object.values(files).flat()
        onDone({
          dev: !!body.dev,
          ref: typeof body.ref === 'string' ? body.ref : '',
          // Always the card owner's name, also when someone else filled the form in as a gift.
          firstName: firstNameOf(brief.name),
          draft: {
            name: brief.name.trim(),
            title: brief.title.trim(),
            company: brief.company.trim(),
            tagline: brief.tagline.trim(),
            logoUrl: files.logo[0]?.url ?? undefined,
            photoUrl: files.photo[0]?.url ?? undefined,
            urls: all.map((f) => f.url).filter((u): u is string => !!u),
          },
        })
        return
      }
      if (r.status === 401) return onLinkInvalid()
      if (body.error === 'not-configured') return onNotConfigured()
      if (body.error === 'invalid' && body.fields) {
        setErrors(body.fields as FieldErrors)
        setAnnounce(body.message || 'Please check the highlighted fields.')
        setSending(false)
        focusFirstInvalid()
        return
      }
      if (body.error === 'file' && body.file) setFileErr((fe) => ({ ...fe, [body.file]: body.message }))
      if (r.status === 429 || body.error === 'rate') setRateLimited(true)
      setSendError(body.message || "We couldn't send your details just now. Please try again.")
      setAnnounce(body.message || "We couldn't send your details just now.")
    } catch (err) {
      console.warn('[onboard] submit failed', err)
      setSendError("We couldn't reach our server. Please check your connection and try again.")
      setAnnounce("We couldn't reach our server. Please try again.")
    }
    setSending(false)
  }

  // ---- preview side follows the field being edited
  const onFocusCapture = (e: FocusEvent<HTMLFormElement>) => {
    const f = (e.target as HTMLElement).dataset.field
    if (f && BACK_FIELDS.has(f)) setSide('back')
    else if (f && FRONT_FIELDS.has(f)) setSide('front')
  }

  const preview = (
    <Preview
      brief={brief}
      logoUrl={files.logo[0]?.url ?? null}
      photoUrl={files.photo[0]?.url ?? null}
      side={side}
      onSide={setSide}
      compact={!wide}
    />
  )

  const err = (k: string) => errors[k]
  const gift = brief.gift
  const phoneHint = gift
    ? 'Include their country code if outside Kenya, e.g. +44 7700 900123.'
    : 'Include your country code if outside Kenya, e.g. +44 7700 900123.'

  return (
    <>
      <div className="ob-head ob-fade">
        <h1 className="h2 ob-head__title">
          Your digital <span className="accent">profile</span>
        </h1>
        <p className="lede">Takes 2 minutes. We'll send you a preview to approve.</p>
      </div>

      {!wide && (
        <div className="ob-mpreview" aria-label="Live card preview" role="region">
          {preview}
        </div>
      )}

      <div className="ob-layout">
        <form className="ob-form" ref={formRef} onSubmit={submit} onFocusCapture={onFocusCapture} noValidate aria-label="Your card details">
          <p className="sr-only" aria-live="polite" role="status">
            {announce}
          </p>

          {/* Honeypot: people never see or reach this field. */}
          <div className="ob-hp" aria-hidden="true">
            <label>
              Fax
              <input name="fax" tabIndex={-1} autoComplete="off" value={hp} onChange={(e) => setHp(e.target.value)} />
            </label>
          </div>

          <fieldset className="ob-fs" disabled={sending}>
            {/* 0. Gift toggle */}
            <div className="ob-gift" data-reveal>
              <label className="ob-toggle">
                <input type="checkbox" role="switch" checked={gift} onChange={(e) => {
                  const on = e.target.checked
                  update({ ...briefRef.current, gift: on }, 'gift')
                  if (!on) setErrors((x) => ({ ...x, ordererName: undefined, ordererPhone: undefined }))
                }} />
                <span className="ob-toggle__track" aria-hidden="true" />
                <span className="ob-toggle__text">This card is a gift / I'm filling this in for someone else.</span>
              </label>
              {gift && (
                <div className="ob-grid ob-gift__who">
                  <Field id="ordererName" label="Your name" required error={err('ordererName')}>
                    {(p) => <input {...p} {...text('ordererName')} className="ob-input" type="text" autoComplete="name" maxLength={MAX.name} />}
                  </Field>
                  <Field id="ordererPhone" label="Your number" required hint="Your WhatsApp, so we can reach you about the order." error={err('ordererPhone')}>
                    {(p) => <input {...p} {...text('ordererPhone')} className="ob-input" type="tel" inputMode="tel" autoComplete="tel" maxLength={MAX.phone} />}
                  </Field>
                </div>
              )}
            </div>

            {/* 1. Business card */}
            <Section num="01" label="Business card">
              <p className="ob-sec__lead">
                {gift ? "Have their business card? Upload a photo of it and we'll copy their details." : "Have a business card? Upload a photo of it and we'll copy your details."}
              </p>
              <Upload
                slot="card"
                cta={files.card.length ? 'Add the other side' : 'Upload your business card'}
                hint="JPG, PNG, WebP, HEIC or PDF. Front and back, if it has both."
                multiple
                files={files.card}
                error={fileErr.card ?? (biggestSlot === 'card' ? totalError : undefined)}
                onAdd={addFiles}
                onRemove={removeFile}
              />
              {files.card.length > 0 && <p className="ob-note">No need to fill in what's on your card, our team will copy it.</p>}
            </Section>

            {/* 2. Details */}
            <Section num="02" label={gift ? "Card owner's details" : 'Your details'}>
              <div className="ob-grid">
                <Field id="name" label={gift ? "Card owner's full name" : 'Full name'} required error={err('name')} full>
                  {(p) => <input {...p} {...text('name')} className="ob-input" type="text" autoComplete={gift ? 'off' : 'name'} maxLength={MAX.name} />}
                </Field>
                <Field id="title" label="Job title" error={err('title')}>
                  {(p) => <input {...p} {...text('title')} className="ob-input" type="text" autoComplete={gift ? 'off' : 'organization-title'} maxLength={MAX.title} />}
                </Field>
                <Field id="company" label="Company" error={err('company')}>
                  {(p) => <input {...p} {...text('company')} className="ob-input" type="text" autoComplete={gift ? 'off' : 'organization'} maxLength={MAX.company} />}
                </Field>
              </div>
            </Section>

            {/* 3. Contact */}
            <Section num="03" label={gift ? 'How people reach them' : 'How people reach you'}>
              <div className="ob-grid">
                <Field id="phone" label={gift ? "Card owner's phone (WhatsApp)" : 'Phone (WhatsApp)'} required hint={phoneHint} error={err('phone')}>
                  {(p) => <input {...p} {...text('phone')} className="ob-input" type="tel" inputMode="tel" autoComplete={gift ? 'off' : 'tel'} maxLength={MAX.phone} />}
                </Field>
                <Field id="phone2" label="Second phone" error={err('phone2')}>
                  {(p) => <input {...p} {...text('phone2')} className="ob-input" type="tel" inputMode="tel" autoComplete="off" maxLength={MAX.phone} />}
                </Field>
                <Field id="email" label="Email" error={err('email')}>
                  {(p) => (
                    <input {...p} {...text('email')} className="ob-input" type="email" inputMode="email" autoComplete={gift ? 'off' : 'email'} autoCapitalize="none" spellCheck={false} maxLength={MAX.email} />
                  )}
                </Field>
                <Field id="website" label="Website" error={err('website')}>
                  {(p) => (
                    <input {...p} {...text('website')} className="ob-input" type="url" inputMode="url" autoComplete={gift ? 'off' : 'url'} autoCapitalize="none" spellCheck={false} placeholder="company.com" maxLength={MAX.url} />
                  )}
                </Field>

                <fieldset className="ob-field ob-field--full ob-set">
                  <legend className="ob-label">Social links</legend>
                  <div className="ob-socials">
                    {brief.socials.map((s, i) => (
                      <div className="ob-social" key={i}>
                        <div className="ob-subfield">
                          <label className="ob-sublabel" htmlFor={`f-social${i}platform`}>
                            Platform
                          </label>
                          <select
                            id={`f-social${i}platform`}
                            className="ob-input ob-select"
                            value={s.platform}
                            onChange={(e) => setSocial(i, { platform: e.target.value as Platform })}
                          >
                            {PLATFORMS.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="ob-subfield">
                          <label className="ob-sublabel" htmlFor={`f-social${i}url`}>
                            Link
                          </label>
                          <input
                            id={`f-social${i}url`}
                            data-field={`social${i}url`}
                            className="ob-input"
                            type="url"
                            inputMode="url"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            placeholder={s.platform === 'Other' ? 'example.com' : `${s.platform.toLowerCase()}.com/…`}
                            maxLength={MAX.url}
                            value={s.url}
                            aria-invalid={!!err(`social${i}url`)}
                            aria-describedby={err(`social${i}url`) ? `social${i}url-error` : undefined}
                            onChange={(e) => setSocial(i, { url: e.target.value })}
                            onBlur={blur(`social${i}url`)}
                          />
                        </div>
                        <button type="button" className="ob-remove" aria-label={`Remove social link ${i + 1} (${s.platform})`} onClick={() => removeSocial(i)}>
                          <Cross />
                        </button>
                        {err(`social${i}url`) && (
                          <p className="ob-error ob-social__error" id={`social${i}url-error`}>
                            <Bang />
                            {err(`social${i}url`)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  {brief.socials.length < MAX_SOCIALS && (
                    <button type="button" className="ob-add ob-add--social" onClick={addSocial}>
                      <span aria-hidden="true">+</span> Add a social link
                    </button>
                  )}
                </fieldset>
              </div>
            </Section>

            {/* 4. Photo, logo and bio */}
            <Section num="04" label="Photo, logo and bio">
              <div className="ob-grid">
                <div className="ob-field">
                  <Upload
                    slot="photo"
                    label="Profile photo"
                    cta={files.photo.length ? 'Replace photo' : 'Upload a photo'}
                    hint={`${kindList('photo')}.`}
                    files={files.photo}
                    error={fileErr.photo ?? (biggestSlot === 'photo' ? totalError : undefined)}
                    onAdd={addFiles}
                    onRemove={removeFile}
                  />
                </div>
                <div className="ob-field">
                  <Upload
                    slot="logo"
                    label="Logo"
                    cta={files.logo.length ? 'Replace logo' : 'Upload your logo'}
                    hint="JPG, PNG, WebP, PDF or SVG."
                    files={files.logo}
                    error={fileErr.logo ?? (biggestSlot === 'logo' ? totalError : undefined)}
                    onAdd={addFiles}
                    onRemove={removeFile}
                  />
                </div>
                <Field id="bio" label="Short bio" error={err('bio')} full counter={`${brief.bio.length}/${MAX.bio}`}>
                  {(p) => <textarea {...p} {...text('bio')} className="ob-input ob-textarea" rows={3} maxLength={MAX.bio} />}
                </Field>
              </div>
            </Section>

            {/* 5. On the card */}
            <Section num="05" label="On your card">
              <div className="ob-grid">
                <Field id="tagline" label="Card tagline" hint="A short line shown on the front of the card." error={err('tagline')} full counter={`${brief.tagline.length}/${MAX.tagline}`}>
                  {(p) => <input {...p} {...text('tagline')} className="ob-input" type="text" autoComplete="off" maxLength={MAX.tagline} />}
                </Field>
                <Field id="notes" label="Anything else we should know?" hint="Colour preferences, special requests." error={err('notes')} full>
                  {(p) => <textarea {...p} {...text('notes')} className="ob-input ob-textarea" rows={4} maxLength={MAX.notes} />}
                </Field>
              </div>
            </Section>

            {/* 6. Consent and send */}
            <div className="ob-sec ob-sec--send" data-reveal>
              <div className="ob-field">
                <label className="ob-check">
                  <input
                    type="checkbox"
                    id="f-consent"
                    data-field="consent"
                    checked={brief.consent}
                    onChange={(e) => update({ ...briefRef.current, consent: e.target.checked, consentAt: e.target.checked ? new Date().toISOString() : '' }, 'consent')}
                    aria-invalid={!!err('consent')}
                    aria-describedby={err('consent') ? 'consent-error' : undefined}
                    aria-required
                  />
                  <span>
                    {gift
                      ? "I have their permission, and agree to these details showing on their public profile and to being contacted about my order."
                      : 'I agree to these details showing on my public profile and to being contacted about my order.'}
                    <span className="ob-req" aria-hidden="true">
                      {' '}
                      *
                    </span>
                  </span>
                </label>
                {err('consent') && (
                  <p className="ob-error" id="consent-error">
                    <Bang />
                    {err('consent')}
                  </p>
                )}
              </div>

              {sendError && (
                <div className="ob-senderr" role="alert">
                  <p>
                    <Bang />
                    {sendError}
                  </p>
                  {rateLimited ? (
                    <CTA href={ORDER_URL} variant="violet" external srNote={ORDER_LINK_NOTE}>
                      Message us on WhatsApp
                    </CTA>
                  ) : (
                    <a href={wa("Hi Taply! I'm having trouble sending my card details.")} target="_blank" rel="noopener noreferrer" className="ob-add">
                      Message us on WhatsApp<span className="sr-only"> (opens WhatsApp in a new tab)</span>
                    </a>
                  )}
                </div>
              )}

              <div className="ob-send">
                <CTA variant="violet" type="submit" disabled={sending} className={`ob-submit${ready && !totalError ? '' : ' is-idle'}${sending ? ' is-sending' : ''}`}>
                  {sending ? (
                    <>
                      <span className="ob-spin" aria-hidden="true" />
                      Sending…
                    </>
                  ) : (
                    'Send my details'
                  )}
                </CTA>
              </div>
            </div>
          </fieldset>
        </form>

        {wide && (
          <aside className="ob-aside" aria-label="Live card preview">
            <p className="mono-label ob-aside__label">Live preview</p>
            {preview}
          </aside>
        )}
      </div>
    </>
  )
}

function Section({ num, label, children }: { num: string; label: string; children: ReactNode }) {
  const id = `ob-sec-${num}`
  return (
    <section className="ob-sec" aria-labelledby={id} data-reveal>
      <h2 className="eyebrow ob-sec__eyebrow" id={id}>
        <span className="eyebrow__num">{num}</span>
        <span>— {label}</span>
        <span className="eyebrow__rule" aria-hidden="true" />
      </h2>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------- preview
function Preview({
  brief,
  logoUrl,
  photoUrl,
  side,
  onSide,
  compact,
}: {
  brief: Brief
  logoUrl: string | null
  photoUrl: string | null
  side: 'front' | 'back'
  onSide: (s: 'front' | 'back') => void
  compact: boolean
}) {
  const back = side === 'back'
  const [flips, setFlips] = useState(0)
  const prev = useRef(back)
  useEffect(() => {
    if (prev.current !== back) setFlips((n) => n + 1)
    prev.current = back
  }, [back])
  return (
    <div className={`ob-preview${compact ? ' ob-preview--compact' : ''}`}>
      <div className={`ycard ycard--preview is-rest${back ? ' is-back' : ''}${flips ? ` is-flip-${flips % 2}` : ''}`}>
        <div className="ycard__view" onClick={() => onSide(back ? 'front' : 'back')} aria-hidden="true">
          <CardBody
            front={{ logoSrc: logoUrl ?? undefined, tagline: brief.tagline.trim(), fallback: 'symbol' }}
            back={{ name: brief.name.trim(), role: brief.title.trim(), company: brief.company.trim(), photoSrc: photoUrl ?? undefined }}
          />
        </div>
        <FlipButton back={back} onClick={() => onSide(back ? 'front' : 'back')} />
      </div>
      <p className="ob-preview__note">Updates as you type. The QR code will open your digital profile.</p>
    </div>
  )
}

// ---------------------------------------------------------------- fields
type InputProps = {
  id: string
  'data-field': string
  'aria-invalid': boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

function Field({
  id,
  label,
  required,
  hint,
  error,
  full,
  counter,
  children,
}: {
  id: string
  label: string
  required?: boolean
  hint?: string
  error?: string
  full?: boolean
  counter?: string
  children: (p: InputProps) => ReactNode
}) {
  const describedBy = [hint && `${id}-hint`, counter && `${id}-count`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className={`ob-field${full ? ' ob-field--full' : ''}`}>
      <label className="ob-label" htmlFor={`f-${id}`}>
        {label}
        {required && (
          <span className="ob-req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id: `f-${id}`, 'data-field': id, 'aria-invalid': !!error, 'aria-describedby': describedBy, 'aria-required': required || undefined })}
      {(hint || counter) && (
        <div className="ob-hintrow">
          {hint && (
            <p className="ob-hint" id={`${id}-hint`}>
              {hint}
            </p>
          )}
          {counter && (
            <p className="ob-count" id={`${id}-count`}>
              {counter}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="ob-error" id={`${id}-error`}>
          <Bang />
          {error}
        </p>
      )}
    </div>
  )
}

function Upload({
  slot,
  label,
  cta,
  hint,
  multiple,
  files,
  error,
  onAdd,
  onRemove,
}: {
  slot: Slot
  /** Visible label above the drop zone (the business card uses its section's lead line instead). */
  label?: string
  cta: string
  hint: string
  multiple?: boolean
  files: Prepared[]
  error?: string
  onAdd: (slot: Slot, list: FileList | File[]) => void
  onRemove: (slot: Slot, id: string) => void
}) {
  const [drag, setDrag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = `file-${slot}`
  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setDrag(false)
      if (e.dataTransfer.files?.length) onAdd(slot, e.dataTransfer.files)
    },
    [onAdd, slot],
  )
  const describedBy = `${id}-hint${error ? ` ${id}-error` : ''}`
  const labelledBy = label ? `${id}-label ${id}-cta` : `${id}-cta`
  return (
    <>
      {label && (
        <span className="ob-label" id={`${id}-label`}>
          {label}
        </span>
      )}
      <label
        className={`ob-drop${drag ? ' is-drag' : ''}${files.length ? ' has-file' : ''}`}
        onDragEnter={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false)
        }}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          id={id}
          className="ob-drop__input"
          type="file"
          data-field={slot}
          accept={SLOT_ACCEPT[slot]}
          multiple={multiple}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-invalid={!!error}
          onChange={(e) => {
            if (e.target.files) onAdd(slot, e.target.files)
            e.target.value = ''
          }}
        />
        <span className="ob-drop__icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 15V4m0 0L6.5 8.5M11 4l4.5 4.5M4 15v3h14v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ob-drop__text" id={`${id}-cta`}>
          {cta}
        </span>
        <span className="ob-drop__hint" id={`${id}-hint`}>
          {hint}
        </span>
      </label>
      {files.length > 0 && (
        <ul className="ob-thumbs" aria-label={`${label ?? 'Business card'} files`}>
          {files.map((f, i) => (
            <li key={f.id}>
              {f.url ? (
                <img className={`ob-thumb ob-thumb--${slot}`} src={f.url} alt="" />
              ) : (
                <span className="ob-thumb ob-thumb--file">{f.kind.toUpperCase()}</span>
              )}
              <span className="ob-thumbs__meta">
                <span className="ob-thumbs__name">
                  {slot === 'card' && files.length > 1 ? `${i === 0 ? 'Front' : 'Back'}: ` : ''}
                  {f.name}
                </span>
                <span className="ob-thumbs__size">{formatBytes(f.file.size)}</span>
              </span>
              <button
                type="button"
                className="ob-remove"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  onRemove(slot, f.id)
                  inputRef.current?.focus()
                }}
              >
                <Cross />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="ob-error" id={`${id}-error`}>
          <Bang />
          {error}
        </p>
      )}
    </>
  )
}

function Bang() {
  return (
    <svg className="ob-error__icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4.2M8 11.2v.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Cross() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

