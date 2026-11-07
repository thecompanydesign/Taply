/*
 * Signed onboarding links. A token is `<payload>.<signature>`:
 *   payload   = base64url(JSON)
 *   signature = base64url(HMAC-SHA256(payload, FORM_LINK_SECRET))
 * Two payloads are accepted:
 *   {id: "universal"}       the one shared link: no client name, never expires
 *   {id, client, exp}       an older per-client link (exp in Unix seconds), kept so links already sent still work
 * scripts/make-link.mjs creates them; /api/verify and /api/submit check them.
 * Changing FORM_LINK_SECRET invalidates every link, the universal one included.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export const UNIVERSAL_ID = 'universal'

/** `id` is "universal" or the per-client link's reference (only used to tell links apart, never shown as the brief's reference). */
export type LinkPayload = { id: string; universal: boolean }

export type TokenCheck = { ok: true; payload: LinkPayload } | { ok: false; reason: 'missing' | 'invalid' | 'expired' | 'not-configured' }

const b64url = (buf: Buffer) => buf.toString('base64url')

export function sign(payloadB64: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payloadB64).digest())
}

export function verifyToken(token: string | null | undefined, secret = process.env.FORM_LINK_SECRET): TokenCheck {
  if (!secret) return { ok: false, reason: 'not-configured' }
  if (!token || typeof token !== 'string' || token.length > 1000) return { ok: false, reason: 'missing' }
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'invalid' }
  const [body, sig] = parts
  const expected = Buffer.from(sign(body, secret))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' }
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'invalid' }

  // The universal link.
  if (payload.id === UNIVERSAL_ID) return { ok: true, payload: { id: UNIVERSAL_ID, universal: true } }

  // An older per-client link.
  if (
    typeof payload.id !== 'string' ||
    typeof payload.client !== 'string' ||
    typeof payload.exp !== 'number' ||
    !/^[A-Z0-9-]{4,24}$/.test(payload.id)
  )
    return { ok: false, reason: 'invalid' }
  if (payload.exp * 1000 < Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, payload: { id: payload.id, universal: false } }
}
