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
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

type Row = [string, string]
type Group = { title: string; rows: Row[] }

function groups(b: Brief, consentAt: string): Group[] {
  const out: Group[] = []
  if (b.gift)
    out.push({
      title: 'Ordered by (gift / filled in for someone else)',
      rows: [
        ['Name', b.ordererName],
        ['Number', b.ordererPhone],
      ],
    })
  out.push(
    {
      title: b.gift ? "Card owner's details" : 'Details',
      rows: [
        ['Full name', b.name],
        ['Job title', b.title],
        ['Company', b.company],
      ],
    },
    {
      title: 'Contact',
      rows: [
        ['Phone (WhatsApp)', b.phone],
        ['Second phone', b.phone2],
        ['Email', b.email],
        ['Website', b.website],
        ['Social links', b.socials.map((x) => `${x.platform}: ${x.url}`).join('\n')],
      ],
    },
    {
      title: 'Profile and card',
      rows: [
        ['Short bio', b.bio],
        ['Card tagline', b.tagline],
        ['Anything else', b.notes],
      ],
    },
    {
      title: 'Consent',
      rows: [
        ['Consent', b.consent ? 'Yes: agreed to these details showing on the public profile and to being contacted about the order.' : 'No'],
        ['Consent given', `${consentAt} (Nairobi time)`],
      ],
    },
  )
  return out
}

function buildEmail(b: Brief, ref: string, link: string, when: string, consentAt: string, files: { filename: string }[]) {
  const all = groups(b, consentAt)
  const fileList = files.length ? files.map((f) => f.filename).join(', ') : 'None'
  const heading = `New Taply brief: ${b.name} (${ref})`
  const text = [
    heading,
    `Reference: ${ref}`,
    `Sent through: ${link}`,
    `Submitted: ${when} (Nairobi time)`,
    `Gift / for someone else: ${b.gift ? 'Yes' : 'No'}`,
    ...all.flatMap((g) => ['', `== ${g.title} ==`, ...g.rows.map(([k, v]) => `${k}: ${v ? v.replace(/\n/g, '\n  ') : '-'}`)]),
    '',
    `Attached files: ${fileList}`,
  ].join('\n')
  const cell = 'padding:10px 14px;border-bottom:1px solid #dddad0;vertical-align:top;font:14px/1.5 Arial,sans-serif;'
  const key = `${cell}color:#55556a;width:34%;`
  const groupHead =
    'padding:18px 14px 8px;border-bottom:1px solid #dddad0;font:600 11px/1.4 Arial,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#4c1bf1;'
  const row = ([k, v]: Row) =>
    `<tr><td style="${key}">${esc(k)}</td><td style="${cell}white-space:pre-wrap;">${v ? esc(v) : '<span style="color:#9a9aa8;">-</span>'}</td></tr>`
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f2ea;color:#13131f;">
<table role="presentation" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #dddad0;border-collapse:collapse;width:100%;">
<tr><td colspan="2" style="padding:20px 14px;border-bottom:3px solid #4c1bf1;font:600 18px/1.3 Arial,sans-serif;">New Taply brief: ${esc(b.name)} <span style="color:#4c1bf1;">(${esc(ref)})</span></td></tr>
${row(['Reference', ref])}
${row(['Sent through', link])}
${row(['Submitted', `${when} (Nairobi time)`])}
${row(['Gift / for someone else', b.gift ? 'Yes' : 'No'])}
${all.map((g) => `<tr><td colspan="2" style="${groupHead}">${esc(g.title)}</td></tr>\n${g.rows.map(row).join('\n')}`).join('\n')}
<tr><td colspan="2" style="${groupHead}">Files</td></tr>
${row(['Attached files', fileList])}
</table></body></html>`
  return { heading, text, html }
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
  const link = check.payload.universal ? 'Universal link' : `Per-client link (${check.payload.id})`

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
  const nairobi = (d: Date, timeStyle: 'short' | 'medium') =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'full', timeStyle }).format(d)
  const when = nairobi(now, 'short')
  const consentAt = nairobi(consentTime(brief, now), 'medium')
  const { heading: subject, text, html } = buildEmail(brief, ref, link, when, consentAt, attachments)

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
