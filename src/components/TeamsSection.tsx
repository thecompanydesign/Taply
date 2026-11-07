import { useState } from 'react'
import type { CSSProperties } from 'react'
import { BrandMark, CTA, ORDER_LINK_NOTE, SectionIntro, TEAM_ORDER_URL } from './shared'

const POINTS = [
  { title: 'One consistent brand', text: 'Your logo and colours on every card, so your team looks like one company.' },
  { title: 'A profile for every person', text: 'Each team member gets their own digital profile and fills in a 2-minute form, we do the rest.' },
  { title: 'One point of contact', text: 'We handle design, printing and delivery, and you talk to one team on WhatsApp.' },
]

const CARDS = 4

export function TeamsSection() {
  // A tap (or hover, in CSS) fans the stack out a little further.
  const [spread, setSpread] = useState(false)

  return (
    <section className="section teams" id="teams">
      <div className="container teams__grid">
        <div className="teams__copy stagger">
          <SectionIntro num="07" label="For teams" tone="lime" dark />
          <h2 className="h2">
            Equip your <span className="accent-lime">whole team.</span>
          </h2>
          <p className="lede">One look, one order, a smart card and digital profile for everyone on your team.</p>
          <ol className="teams__points">
            {POINTS.map((p, i) => (
              <li key={p.title}>
                <span className="mono-label teams__num">{String(i + 1).padStart(2, '0')}</span>
                <span>
                  <strong>{p.title}</strong> {p.text}
                </span>
              </li>
            ))}
          </ol>
          <div className="teams__action">
            <CTA href={TEAM_ORDER_URL} variant="lime" external srNote={ORDER_LINK_NOTE}>
              Request a team quote
            </CTA>
            <p className="teams__note">Tell us how many cards you need and we'll take it from there.</p>
          </div>
        </div>

        <div className="teams__visual trigger" aria-hidden="true">
          <span className="teams__circle" data-parallax="0.06" />
          <div className={`teams__stack${spread ? ' is-spread' : ''}`} onClick={() => setSpread((s) => !s)}>
            {Array.from({ length: CARDS }, (_, i) => (
              <div className="teams__card" key={i} style={{ '--n': i } as CSSProperties}>
                <div className="pcard pcard--light">
                  <div className="pcard__face">
                    <BrandMark variant="symbol" className="teams__symbol" />
                    <span className="pcard__gloss" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
