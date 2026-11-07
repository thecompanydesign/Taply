import type { IncomingMessage, ServerResponse } from 'node:http'
import { verifyToken } from './_lib/token.js'
import { queryParam, sendJson } from './_lib/http.js'

/**
 * GET /api/verify?t=<token>: is this onboarding link valid?
 * Returns only a key the browser uses to keep an unsent draft per link
 * ("universal", or an older per-client link's ID). No client name.
 */
export default function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, reason: 'method' })
  const check = verifyToken(queryParam(req, 't'))
  if (!check.ok) {
    if (check.reason === 'not-configured') console.warn('[verify] FORM_LINK_SECRET is not set')
    return sendJson(res, check.reason === 'not-configured' ? 500 : 401, { ok: false, reason: check.reason })
  }
  return sendJson(res, 200, { ok: true, key: check.payload.id })
}
