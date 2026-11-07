import { useLayoutEffect, useRef, useState } from 'react'
import { SectionIntro } from './shared'

const FAQS = [
  {
    q: 'Does Taply work with iPhones?',
    a: 'Compatible iPhones open the profile with an NFC tap, or by scanning the QR code.',
  },
  {
    q: 'Can I order for my whole team?',
    a: 'Yes. Tell us how many cards you need and we’ll send you a team quote on WhatsApp. Every team member gets a card and their own digital profile, with your company branding kept consistent.',
  },
  {
    q: 'Does it work with Android?',
    a: 'Compatible Android phones open the profile with an NFC tap, or by scanning the QR code.',
  },
  {
    q: 'What if someone’s phone doesn’t support NFC?',
    a: 'They can scan the QR code printed on the card.',
  },
  {
    q: 'Does the recipient need to download an app?',
    a: 'No, the profile opens in their browser.',
  },
  {
    q: 'Does the physical card need charging?',
    a: 'No, the NFC card is passive, with no battery and no charging.',
  },
  {
    q: 'Can I update my details after receiving the card?',
    a: 'Yes, your profile can be updated without reprinting the card.',
  },
  {
    q: 'Can I include my social media accounts?',
    a: 'Yes, alongside your other professional links.',
  },
  {
    q: 'Can I use the card for international networking?',
    a: 'Yes, your profile supports up to 12 languages.',
  },
  {
    q: 'How long does it take to get my card?',
    a: 'Your digital profile is designed to your liking within hours. Once you approve the final digital mockup, printing the physical card takes 2 days.',
  },
  {
    q: 'What are the payment terms?',
    a: 'Pay 50% to secure your order, then the remaining 50% before dispatch, once your card is complete.',
  },
]

export function FAQSection() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const listRef = useRef<HTMLDivElement>(null)
  const before = useRef<number[] | null>(null)

  // The panel's height changes at once (no height animation); the questions
  // below slide from where they were to where they now are (transform only),
  // while the answer fades in.
  const toggle = (i: number) => {
    const items = listRef.current ? [...listRef.current.children] : []
    before.current = items.map((el) => el.getBoundingClientRect().top)
    setOpenFaq((cur) => (cur === i ? null : i))
  }
  useLayoutEffect(() => {
    const old = before.current
    before.current = null
    const list = listRef.current
    if (!old || !list || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    ;[...list.children].forEach((el, i) => {
      const dy = old[i] - el.getBoundingClientRect().top
      if (Math.abs(dy) < 0.5) return
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
        duration: 450,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    })
  }, [openFaq])

  return (
    <section className="section faq" id="faq">
      <div className="container faq__grid">
        <div className="faq__head stagger">
          <SectionIntro num="08" label="Questions" />
          <h2 className="h2">
            Simple answers.
            <br />
            <span className="accent">No fine print.</span>
          </h2>
          <p className="lede">
            Taply is designed to work quietly in the background, so the conversation can stay in focus.
          </p>
        </div>

        <div className="accordion stagger" ref={listRef}>
          {FAQS.map((item, i) => {
            const open = openFaq === i
            return (
              <div className={`acc${open ? ' is-open' : ''}`} key={item.q}>
                <h3 className="acc__heading">
                  <button
                    type="button"
                    id={`faq-trigger-${i}`}
                    className="acc__trigger"
                    aria-expanded={open}
                    aria-controls={`faq-panel-${i}`}
                    onClick={() => toggle(i)}
                  >
                    <span>{item.q}</span>
                    <span className="acc__icon" aria-hidden="true" />
                  </button>
                </h3>
                <div
                  id={`faq-panel-${i}`}
                  role="region"
                  aria-labelledby={`faq-trigger-${i}`}
                  className="acc__panel"
                >
                  <div className="acc__inner">
                    <p>{item.a}</p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
