// Creates signed links to the client onboarding form.
//
//   npm run link                                     the universal link (reusable, never expires)
//   node scripts/make-link.mjs                       same
//   node scripts/make-link.mjs "Client name" [days=14] [https://your-domain]
//                                                    a one-off link that expires
//
// Needs FORM_LINK_SECRET (the same value as in Vercel). It is read from the
// environment, or from .env.local / .env in the project root if present.
// The domain comes from SITE_URL (or the third argument of the one-off form).
// Changing FORM_LINK_SECRET invalidates every link, the universal one included.
import { createHmac, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
for (const name of ['.env.local', '.env']) {
  const file = root + name
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

const [client, daysArg, domainArg] = process.argv.slice(2)
const universal = client === undefined
const secret = process.env.FORM_LINK_SECRET
const site = (domainArg || process.env.SITE_URL || '').replace(/\/+$/, '')
const days = daysArg === undefined ? 14 : Number(daysArg)

const fail = (msg) => {
  console.error(msg)
  process.exit(1)
}
if (!universal && !client.trim()) fail('Usage: npm run link   (universal link)\n   or: node scripts/make-link.mjs "Client or company name" [days=14] [https://your-domain]')
if (!secret) fail('FORM_LINK_SECRET is not set. Add it to .env.local or run: FORM_LINK_SECRET=... node scripts/make-link.mjs ...')
if (!universal && (!Number.isFinite(days) || days <= 0 || days > 365)) fail('Days must be a number between 1 and 365.')
if (!/^https?:\/\/[^/]+$/.test(site)) fail('Set SITE_URL (for example https://taply.example) in .env.local, or pass the domain as the third argument.')

const signed = (data) => {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  const signature = createHmac('sha256', secret).update(payload).digest('base64url')
  return `${site}/onboard?t=${payload}.${signature}`
}

if (universal) {
  // The same secret always gives the same link: no client name, no expiry.
  console.log(signed({ id: 'universal' }))
  console.error(
    [
      '',
      'This is the UNIVERSAL onboarding link. It is reusable: send the same link to every client.',
      'It never expires. Each submission gets its own TP- reference when it is sent.',
      'Changing FORM_LINK_SECRET in Vercel turns it off (and every other link).',
    ].join('\n'),
  )
} else {
  // One-off link: reference ID TP- plus 6 characters without look-alikes (0/O, 1/I).
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const id = 'TP-' + [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join('')
  const exp = Math.floor(Date.now() / 1000) + Math.round(days * 86400)
  console.log(signed({ id, client: client.trim().slice(0, 120), exp }))
  console.error(`One-off link for "${client.trim()}" (${id}), valid until ${new Date(exp * 1000).toISOString().slice(0, 10)}.`)
}
