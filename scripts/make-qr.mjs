// Generates public/brand/taply-qr.svg: a real QR code for https://taply.co.ke
// (error correction M), Carbon modules on a white rounded tile with a
// 4-module quiet zone. Runs before every build; the output is deterministic.
//
//   node scripts/make-qr.mjs
//
// Check it with `node scripts/verify-qr.mjs`, which renders the SVG and decodes it.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

export const QR_URL = 'https://taply.co.ke'
const OUT = fileURLToPath(new URL('../public/brand/taply-qr.svg', import.meta.url))
const QUIET = 4
const CARBON = '#13131f'

const { modules, version } = QRCode.create(QR_URL, { errorCorrectionLevel: 'M' })
const n = modules.size
const total = n + QUIET * 2

// One path: each run of dark modules in a row becomes one rectangle.
let d = ''
for (let y = 0; y < n; y++) {
  for (let x = 0; x < n; ) {
    if (!modules.get(y, x)) {
      x++
      continue
    }
    let run = 1
    while (x + run < n && modules.get(y, x + run)) run++
    d += `M${x + QUIET} ${y + QUIET}h${run}v1h-${run}z`
    x += run
  }
}

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total * 8}" height="${total * 8}" shape-rendering="crispEdges">` +
  `<title>QR code: ${QR_URL}</title>` +
  `<rect width="${total}" height="${total}" rx="2.4" fill="#ffffff" shape-rendering="geometricPrecision"/>` +
  `<path fill="${CARBON}" d="${d}"/>` +
  `</svg>\n`

writeFileSync(OUT, svg)
console.log(`taply-qr.svg: ${QR_URL}, version ${version}, ${n}×${n} modules + ${QUIET}-module quiet zone, EC level M`)
