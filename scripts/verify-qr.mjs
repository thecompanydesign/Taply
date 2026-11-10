// Renders public/brand/taply-qr.svg to pixels (resvg) at several sizes and
// decodes it with jsQR. Exits non-zero unless every render decodes to exactly
// https://taply.co.ke.
//
//   node scripts/verify-qr.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import jsQR from 'jsqr'

const EXPECTED = 'https://taply.co.ke'
const svg = readFileSync(fileURLToPath(new URL('../public/brand/taply-qr.svg', import.meta.url)))

let ok = true
for (const width of [99, 160, 264, 600]) {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width }, background: '#13131f' }).render()
  const code = jsQR(new Uint8ClampedArray(img.pixels), img.width, img.height)
  const text = code ? code.data : null
  const pass = text === EXPECTED
  ok &&= pass
  console.log(`${String(width).padStart(4)}px render -> ${JSON.stringify(text)} ${pass ? 'PASS' : 'FAIL'}`)
}
console.log(ok ? `QR decodes to exactly ${EXPECTED}` : 'QR check FAILED')
process.exit(ok ? 0 : 1)
