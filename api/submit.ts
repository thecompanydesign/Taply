import type { IncomingMessage, ServerResponse } from 'node:http'
import busboy from 'busboy'
import nodemailer from 'nodemailer'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyToken } from './_lib/token.js'
import { clientIp, isDeployed, sendJson } from './_lib/http.js'
import {
  EMPTY_BRIEF,
  MAX,
  MAX_CARD_FILES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  MAX_SOCIALS,
  MIN_FILL_SECONDS,
  PLATFORMS,
  validateBrief,
} from '../src/onboard/limits.js'
import type { Brief, Platform } from '../src/onboard/limits.js'

/*
 * POST /api/submit (multipart/form-data)
 *   header x-taply-token: the signed link token (checked before the body is read)
 *   fields: brief (JSON), elapsed (seconds on the form), fax (honeypot, must be empty)
 *   files:  logo, photo, card (up to 2: front and back)
 * Validates everything, then emails the brief with the files attached to
 * NOTIFY_EMAIL through Gmail SMTP. Nothing is stored on the server.
 */

type Kind = 'png' | 'jpg' | 'webp' | 'svg' | 'pdf' | 'heic'
type Upload = { field: string; kind: Kind; data: Buffer }

const ALLOWED: Record<string, Kind[]> = {
  logo: ['jpg', 'png', 'webp', 'pdf', 'svg'],
  photo: ['jpg', 'png', 'webp', 'heic'],
  card: ['jpg', 'png', 'webp', 'heic', 'pdf'],
}
const MIME: Record<Kind, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  heic: 'image/heic',
}
const LABEL: Record<string, string> = { logo: 'logo', photo: 'profile photo', card: 'business card' }
const typeList = (kinds: Kind[]) => {
  const names = kinds.map((k) => (k === 'webp' ? 'WebP' : k.toUpperCase()))
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

// ---------------------------------------------------------------- abuse limits
// Best effort (kept in memory, so per function instance): accepted submissions per IP.
const HOUR = 3600_000
const DAY = 24 * HOUR
const PER_HOUR = 5
const PER_DAY = 20
const hits = new Map<string, number[]>()
function recentHits(ip: string, now: number): number[] {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < DAY)
  if (recent.length) hits.set(ip, recent)
  else hits.delete(ip)
  return recent
}
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const recent = recentHits(ip, now)
  return recent.length >= PER_DAY || recent.filter((t) => now - t < HOUR).length >= PER_HOUR
}
function recordHit(ip: string) {
  const now = Date.now()
  hits.set(ip, [...recentHits(ip, now), now])
  if (hits.size > 5000) for (const k of [...hits.keys()].slice(0, 1000)) hits.delete(k) // bound memory
}

// ---------------------------------------------------------------- reference
// TP- plus 6 characters without look-alikes (no 0/O, 1/I). 32 symbols, so a byte maps without bias.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newRef = () => 'TP-' + [...randomBytes(6)].map((b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')

// ---------------------------------------------------------------- files
/** File type from its first bytes, never from the name or the browser's claim. */
function sniff(b: Buffer): Kind | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  if (b.length >= 5 && b.toString('latin1', 0, 5) === '%PDF-') return 'pdf'
  if (b.length >= 12 && b.toString('latin1', 4, 8) === 'ftyp' && /^(heic|heix|heim|heis|hevc|hevx|mif1|msf1)$/.test(b.toString('latin1', 8, 12))) return 'heic'
  const head = b.subarray(0, 4096).toString('utf8').replace(/^﻿/, '')
  const rest = head
    .replace(/^\s*<\?xml[\s\S]*?\?>/, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/, '')
    .replace(/^\s*<!DOCTYPE[\s\S]*?>/i, '')
    .replace(/^(\s*<!--[\s\S]*?-->)*/, '')
  if (/^\s*<svg[\s>]/i.test(rest)) return 'svg'
  return null
}

/** SVGs may not carry scripts, event handlers, javascript: URLs or embedded HTML. */
function unsafeSvg(b: Buffer): boolean {
  const text = b.toString('utf8')
  return /<script\b|\son[a-z]+\s*=|javascript:|<foreignObject\b|<iframe\b|<embed\b|<object\b/i.test(text)
}

// ---------------------------------------------------------------- the brief
// Control characters (keeping tab and newline for the multi-line fields) and invisible
// direction overrides, which could disguise text in the email.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩]/g
/**
 * A clean string. Over-long values are cut to one character past the limit,
 * so validateBrief still rejects them rather than silently shortening them.
 */
const str = (v: unknown, max: number, multiline = false) => {
  if (typeof v !== 'string') return ''
  let s = v.replace(/\r\n?/g, '\n').replace(CONTROL, '')
  if (!multiline) s = s.replace(/[\t\n]+/g, ' ')
  return s.trim().slice(0, max + 1)
}

/** Rebuilds the brief from untrusted JSON, keeping only known fields of the right type. */
function cleanBrief(raw: unknown): { brief: Brief; socialCount: number } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const b: Brief = { ...EMPTY_BRIEF }
  b.gift = r.gift === true
  b.ordererName = b.gift ? str(r.ordererName, MAX.name) : ''
  b.ordererPhone = b.gift ? str(r.ordererPhone, MAX.phone) : ''
  b.name = str(r.name, MAX.name)
  b.title = str(r.title, MAX.title)
  b.company = str(r.company, MAX.company)
  b.phone = str(r.phone, MAX.phone)
  b.phone2 = str(r.phone2, MAX.phone)
  b.email = str(r.email, MAX.email)
  b.website = str(r.website, MAX.url)
  const socials = Array.isArray(r.socials) ? r.socials : []
  b.socials = socials
    .slice(0, MAX_SOCIALS + 1)
    .map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const platform = ((PLATFORMS as readonly string[]).includes(o.platform as string) ? o.platform : 'Other') as Platform
      return { platform, url: str(o.url, MAX.url) }
    })
    .filter((x) => x.url)
  b.bio = str(r.bio, MAX.bio, true)
  b.tagline = str(r.tagline, MAX.tagline)
  b.notes = str(r.notes, MAX.notes, true)
  b.consent = r.consent === true
  b.consentAt = typeof r.consentAt === 'string' ? r.consentAt.slice(0, 40) : ''
  return { brief: b, socialCount: socials.length }
}

/** The browser's consent time, if it is a sane one (not in the future, not older than 30 days); else now. */
function consentTime(b: Brief, now: Date): Date {
  const ms = new Date(b.consentAt).getTime()
  if (Number.isFinite(ms) && ms <= now.getTime() + 60_000 && now.getTime() - ms < 30 * 86_400_000) return new Date(ms)
  return now
}

// ---------------------------------------------------------------- email
/*
 * A short, scannable notification. Only answered fields appear: an empty
 * value never renders a row, and a section with no rows is left out with
 * its label. Inline styles and tables only (email clients drop <style>);
 * the plain-text version follows the same rules.
 */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const has = (v: string | undefined | null): v is string => typeof v === 'string' && v.trim() !== ''

/** "Saturday, 7 November 2026, 20:15" in Nairobi time. */
function nairobiTime(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return `${parts.weekday}, ${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`
}

/** An http(s) address for a link, or null when the value isn't one (e.g. an @handle). */
function webHref(v: string): string | null {
  if (v.startsWith('@')) return null
  const s = /^[a-z][a-z\d+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(s)
    const web = (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && !u.username && !u.password
    return web ? u.href : null
  } catch {
    return null
  }
}

const digits = (v: string) => v.replace(/\D/g, '')

/** A row value: plain text, or text with a link. */
type Value = { text: string; href?: string | null }
type Row = { label: string; value: Value }
type Section =
  | { label: string; kind: 'rows'; rows: Row[] }
  | { label: string; kind: 'person'; name: string; line: string }
  | { label: string; kind: 'para'; text: string; rows?: Row[] }

const row = (label: string, v: string | undefined, href?: string | null): Row[] => (has(v) ? [{ label, value: { text: v.trim(), href } }] : [])

function sections(b: Brief): Section[] {
  const out: Section[] = []

  const role = [b.title, b.company].filter(has).map((s) => s.trim()).join(', ')
  if (has(b.name) || role) out.push({ label: 'Person', kind: 'person', name: b.name.trim(), line: role })

  // The main number is the WhatsApp number; a second number that is the same is not repeated.
  const second = has(b.phone2) && digits(b.phone2) !== digits(b.phone) ? b.phone2 : ''
  const contact = [
    ...row('Phone / WhatsApp', b.phone),
    ...row('Email', b.email, has(b.email) ? `mailto:${b.email.trim()}` : null),
    ...row('Website', b.website, has(b.website) ? webHref(b.website.trim()) : null),
    ...row('Second phone', second),
  ]
  if (contact.length) out.push({ label: 'Contact', kind: 'rows', rows: contact })

  const socials = b.socials.filter((s) => has(s.url)).flatMap((s) => row(s.platform, s.url, webHref(s.url.trim())))
  if (socials.length) out.push({ label: 'Socials', kind: 'rows', rows: socials })

  if (has(b.bio)) out.push({ label: 'Bio', kind: 'para', text: b.bio.trim() })

  const card = row('Tagline', b.tagline)
  if (has(b.notes)) out.push({ label: 'On the card', kind: 'para', text: b.notes.trim(), rows: card })
  else if (card.length) out.push({ label: 'On the card', kind: 'rows', rows: card })

  if (b.gift) {
    const by = [b.ordererName, b.ordererPhone].filter(has).map((s) => s.trim()).join(', ')
    if (by) out.push({ label: 'Gift order', kind: 'para', text: `Ordered by ${by}` })
  }
  return out
}

/** "business card, logo, profile photo": only what was actually attached. */
function attachedLine(fields: string[]): string {
  const names: string[] = []
  const cards = fields.filter((f) => f === 'card').length
  if (cards) names.push(cards > 1 ? 'business card (front and back)' : 'business card')
  if (fields.includes('logo')) names.push('logo')
  if (fields.includes('photo')) names.push('profile photo')
  return names.join(', ')
}

// Neutral text only: the brand violet appears only in the symbol image, so
// Gmail's dark mode can't shift it.
const C = {
  ink: '#13131f',
  muted: '#6b6b7b',
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
}

/** The live site's address for the symbol image: SITE_URL, or this request's origin. */
function siteOrigin(req: IncomingMessage): string {
  const fromEnv = (process.env.SITE_URL ?? '').trim().replace(/\/+$/, '')
  if (/^https?:\/\/[^/\s]+$/i.test(fromEnv)) return fromEnv
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim()
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || ''
  const proto = first(req.headers['x-forwarded-proto']) || (isDeployed() ? 'https' : 'http')
  return /^[a-z0-9.-]+(:\d+)?$/i.test(host) && /^https?$/.test(proto) ? `${proto}://${host}` : ''
}

function buildEmail(b: Brief, ref: string, submitted: Date, consentAt: Date, attachedFields: string[], site: string) {
  const subject = `New profile details: ${b.name.trim()} (${ref})`
  const meta = `${ref} · ${nairobiTime(submitted)} Nairobi time`
  const attached = attachedLine(attachedFields)
  const consent = `Consent to show on public profile and be contacted: given ${nairobiTime(consentAt)} Nairobi time`
  const all = sections(b)

  // ---- plain text
  const textRows = (rows: Row[]) => rows.map((r) => `${r.label}: ${r.value.text}`)
  const text = [
    'Taply',
    'New profile details',
    meta,
    ...all.flatMap((s) => {
      const body =
        s.kind === 'person'
          ? [s.name, s.line].filter(Boolean)
          : s.kind === 'rows'
            ? textRows(s.rows)
            : [...textRows(s.rows ?? []), s.text]
      return ['', s.label.toUpperCase(), ...body]
    }),
    ...(attached ? ['', `Attached: ${attached}`] : []),
    '',
    consent,
  ].join('\n')

  // ---- HTML
  const p = (style: string, inner: string) => `<p style="margin:0;${style}">${inner}</p>`
  const textHtml = (s: string) => esc(s).replace(/\n/g, '<br>')
  const valueHtml = (v: Value) =>
    v.href
      ? `<a href="${esc(v.href)}" style="color:${C.ink};text-decoration:underline;word-break:break-all;">${esc(v.text)}</a>`
      : textHtml(v.text)
  const rowsHtml = (rows: Row[]) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">${rows
      .map(
        (r) =>
          `<tr><td width="110" valign="top" style="width:110px;padding:7px 12px 5px 0;font:13px/1.5 ${C.font};color:${C.muted};">${esc(r.label)}</td>` +
          `<td valign="top" style="padding:5px 0;font:15px/1.5 ${C.font};color:${C.ink};word-break:break-word;overflow-wrap:anywhere;">${valueHtml(r.value)}</td></tr>`,
      )
      .join('')}</table>`
  const label = (s: string) =>
    p(`padding:0 0 8px;font:600 11px/1.4 ${C.font};letter-spacing:.12em;text-transform:uppercase;color:${C.muted};`, esc(s))
  const para = (s: string) => p(`font:15px/1.6 ${C.font};color:${C.ink};word-break:break-word;overflow-wrap:anywhere;`, textHtml(s))
  const sectionHtml = (s: Section) => {
    const body =
      s.kind === 'person'
        ? (s.name ? p(`font:700 22px/1.3 ${C.font};color:${C.ink};`, esc(s.name)) : '') +
          (s.line ? p(`padding-top:2px;font:15px/1.5 ${C.font};color:${C.ink};`, esc(s.line)) : '')
        : s.kind === 'rows'
          ? rowsHtml(s.rows)
          : (s.rows?.length ? rowsHtml(s.rows) + '<div style="height:6px;line-height:6px;">&nbsp;</div>' : '') + para(s.text)
    return `<tr><td style="padding:0 0 28px;">${label(s.label)}${body}</td></tr>`
  }

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;color:${C.ink};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;border-collapse:collapse;">
<tr><td style="padding:0 0 24px;">${
   site
     ? `<img src="${esc(site)}/brand/taply-symbol.png" alt="Taply" width="36" height="28" style="display:block;border:0;outline:none;text-decoration:none;width:36px;height:28px;">`
     : p(`font:700 15px/1 ${C.font};color:${C.ink};`, 'Taply')
 }</td></tr>
<tr><td style="padding:0 0 6px;">${p(`font:700 26px/1.25 ${C.font};color:${C.ink};`, 'New profile details')}</td></tr>
<tr><td style="padding:0 0 32px;">${p(`font:14px/1.5 ${C.font};color:${C.muted};`, esc(meta))}</td></tr>
${all.map(sectionHtml).join('\n')}
${attached ? `<tr><td style="padding:0 0 28px;">${p(`font:14px/1.5 ${C.font};color:${C.ink};`, `<span style="color:${C.muted};">Attached:</span> ${esc(attached)}`)}</td></tr>` : ''}
<tr><td style="padding:8px 0 0;">${p(`font:12px/1.5 ${C.font};color:${C.muted};`, esc(consent))}</td></tr>
</table>
</td></tr>
</table>
</body></html>`
  return { subject, text, html }
}

// ---------------------------------------------------------------- multipart
type Parsed = { fields: Record<string, string>; files: Upload[]; error?: { status: number; message: string; file?: string } }

function parse(req: IncomingMessage): Promise<Parsed> {
  return new Promise((resolve) => {
    const out: Parsed = { fields: {}, files: [] }
    let total = 0
    let settled = false
    const fail = (status: number, message: string, file?: string) => {
      if (!out.error) out.error = { status, message, file }
    }
    let bb: busboy.Busboy
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 8, fieldSize: 24_000, parts: 16 },
      })
    } catch {
      return resolve({ ...out, error: { status: 400, message: 'Please send the form as multipart/form-data.' } })
    }
    bb.on('field', (name, value) => {
      out.fields[name] = value
    })
    bb.on('file', (field, stream) => {
      const chunks: Buffer[] = []
      let size = 0
      stream.on('data', (c: Buffer) => {
        size += c.length
        total += c.length
        if (total > MAX_TOTAL_BYTES) fail(413, 'Your files are too large together. Please use smaller files (4MB in total).')
        else chunks.push(c)
      })
      stream.on('limit', () => fail(413, `Your ${LABEL[field] ?? 'file'} is too large. Please use a file under 4MB.`, field))
      stream.on('end', () => {
        if (!ALLOWED[field]) return fail(400, 'Unexpected file.', field)
        if (!size) return
        const data = Buffer.concat(chunks)
        const kind = sniff(data)
        if (!kind || !ALLOWED[field].includes(kind))
          return fail(415, `Your ${LABEL[field]} isn't a supported file type. Please use ${typeList(ALLOWED[field])}.`, field)
        if (kind === 'svg' && unsafeSvg(data)) return fail(415, 'This SVG logo contains scripts or links we can\'t accept. Please export it again, or upload a PNG.', field)
        out.files.push({ field, kind, data })
      })
    })
    bb.on('filesLimit', () => fail(413, `Please upload at most ${MAX_FILES} files.`))
    bb.on('fieldsLimit', () => fail(400, 'Too many fields.'))
    bb.on('partsLimit', () => fail(400, 'Too many parts.'))
    bb.on('error', () => {
      fail(400, 'The upload could not be read. Please try again.')
      if (!settled) {
        settled = true
        resolve(out)
      }
    })
    bb.on('close', () => {
      if (!settled) {
        settled = true
        resolve(out)
      }
    })
    req.pipe(bb)
  })
}

// ---------------------------------------------------------------- handler
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' })

  const ip = clientIp(req)
  if (rateLimited(ip))
    return sendJson(res, 429, { ok: false, error: 'rate', message: 'Too many submissions, please try again later or WhatsApp us.' })

  const length = Number(req.headers['content-length'] || 0)
  if (length > MAX_TOTAL_BYTES + 256 * 1024)
    return sendJson(res, 413, { ok: false, error: 'too-large', message: 'Your files are too large together. Please use smaller files (4MB in total).' })

  // Nothing is accepted without a valid link.
  const tokenHeader = req.headers['x-taply-token']
  const check = verifyToken(Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader)
  if (!check.ok) {
    if (check.reason === 'not-configured') {
      console.warn('[submit] FORM_LINK_SECRET is not set')
      return sendJson(res, 500, { ok: false, error: 'not-configured', message: "The form isn't set up yet." })
    }
    return sendJson(res, 401, { ok: false, error: 'link', reason: check.reason, message: "This link isn't active." })
  }
  // A fresh reference for every submission: the link is shared, so it can't carry one.
  const ref = newRef()

  const parsed = await parse(req)
  if (parsed.error) return sendJson(res, parsed.error.status, { ok: false, error: 'file', file: parsed.error.file, message: parsed.error.message })

  // Spam checks: honeypot filled, or the form was filled impossibly fast. Bots get a quiet success.
  if (parsed.fields.fax) {
    recordHit(ip)
    return sendJson(res, 200, { ok: true, ref })
  }
  const elapsed = Number(parsed.fields.elapsed)
  if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_SECONDS)
    return sendJson(res, 400, { ok: false, error: 'too-fast', message: 'That was very quick. Please check your details and send again.' })

  let raw: unknown
  try {
    raw = JSON.parse(parsed.fields.brief ?? '')
  } catch {
    return sendJson(res, 400, { ok: false, error: 'invalid', message: 'The form data could not be read.' })
  }
  const { brief, socialCount } = cleanBrief(raw)
  if (socialCount > MAX_SOCIALS)
    return sendJson(res, 400, { ok: false, error: 'invalid', fields: { socials: `Up to ${MAX_SOCIALS} social links.` }, message: `Please add at most ${MAX_SOCIALS} social links.` })
  const errors = validateBrief(brief)
  if (Object.keys(errors).length) return sendJson(res, 400, { ok: false, error: 'invalid', fields: errors, message: 'Please check the highlighted fields.' })

  const cards = parsed.files.filter((f) => f.field === 'card')
  if (cards.length > MAX_CARD_FILES) return sendJson(res, 400, { ok: false, error: 'file', file: 'card', message: 'Please upload at most 2 business card files (front and back).' })
  if (parsed.files.filter((f) => f.field === 'logo').length > 1 || parsed.files.filter((f) => f.field === 'photo').length > 1)
    return sendJson(res, 400, { ok: false, error: 'file', message: 'Please upload one logo and one profile photo.' })

  let n = 0
  const attachments = parsed.files.map((f) => ({
    filename: f.field === 'card' ? `${ref}-business-card-${++n}.${f.kind}` : `${ref}-${f.field}.${f.kind}`,
    content: f.data,
    contentType: MIME[f.kind],
  }))
  const now = new Date()
  const { subject, text, html } = buildEmail(brief, ref, now, consentTime(brief, now), parsed.files.map((f) => f.field), siteOrigin(req))

  const { NOTIFY_EMAIL, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env
  if (!NOTIFY_EMAIL || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    if (isDeployed()) {
      console.error('[submit] NOTIFY_EMAIL, GMAIL_USER or GMAIL_APP_PASSWORD is not set')
      return sendJson(res, 500, { ok: false, error: 'not-configured', message: "The form isn't set up yet." })
    }
    // Local development without mail settings: show what would be sent.
    const preview = join(tmpdir(), `taply-brief-${ref}.html`)
    try {
      writeFileSync(preview, html)
    } catch (e) {
      console.warn('[submit] could not write the email preview', e)
    }
    console.log(`\n[submit] DEV MODE, not emailed\nSubject: ${subject}\n${text}\nFiles: ${attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(', ') || 'none'}\nHTML preview: ${preview}\n`)
    recordHit(ip)
    return sendJson(res, 200, { ok: true, ref, dev: true })
  }

  try {
    const transport = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } })
    await transport.sendMail({
      from: { name: 'Taply client briefs', address: GMAIL_USER },
      to: NOTIFY_EMAIL,
      // Replies go to the client when they gave an email address.
      ...(brief.email ? { replyTo: { name: brief.name, address: brief.email } } : {}),
      subject,
      text,
      html,
      attachments,
    })
  } catch (e) {
    console.error('[submit] sending failed', e)
    return sendJson(res, 502, { ok: false, error: 'send', message: "We couldn't send your details just now. Please try again, or message us on WhatsApp." })
  }
  recordHit(ip)
  return sendJson(res, 200, { ok: true, ref })
}
