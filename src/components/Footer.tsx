import { Arrow, BrandMark, ORDER_LINK_NOTE, ORDER_URL } from './shared'

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__grid">
          <div className="footer__brand">
            <BrandMark variant="reversed" alt="Taply" className="footer__logo" />
            <p>A smarter, more memorable way to share your professional identity.</p>
          </div>

          <nav aria-label="Explore">
            <h2 className="mono-label footer__h">Explore</h2>
            <ul>
              <li>
                <a href="#how">How it works</a>
              </li>
              <li>
                <a href="#features">Features</a>
              </li>
              <li>
                <a href="#faq">FAQ</a>
              </li>
            </ul>
          </nav>

          <div>
            <h2 className="mono-label footer__h">Contact</h2>
            <ul>
              <li>
                <a href="tel:+254140986500">+254 140 986 500</a>
              </li>
              <li>
                <a href={ORDER_URL} target="_blank" rel="noreferrer">
                  <span>
                    Order on <span className="footer__nowrap">WhatsApp<Arrow /></span>
                  </span>
                  <span className="sr-only">{ORDER_LINK_NOTE}</span>
                </a>
              </li>
            </ul>
          </div>

          <div className="footer__taply">
            <h2 className="mono-label footer__h">Taply</h2>
            <ul>
              <li>
                <a href="https://taply.com" target="_blank" rel="noreferrer">
                  taply.com
                </a>
              </li>
              <li>
                <a href={ORDER_URL} target="_blank" rel="noopener noreferrer">
                  Order on WhatsApp<span className="sr-only">{ORDER_LINK_NOTE}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer__bottom">
          <p>© 2026 Taply. All rights reserved.</p>
          <p className="footer__credit">
            Website built &amp; designed by{' '}
            <a href="https://the-company-design-website.vercel.app/?utm_source=luxecard&utm_medium=footer" target="_blank" rel="noopener noreferrer">
              thecompany.design
            </a>
          </p>
        </div>
      </div>
    </footer>
  )
}
