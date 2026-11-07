import { SectionIntro } from './shared'

const USE_CASES = ['Business meetings', 'Networking events', 'Conferences', 'Client introductions']

export function RealWorldSection() {
  return (
    <section className="real" id="moments">
      <div className="real__media reveal">
        <img
          src="/brand/networking.jpg"
          alt="People walking along a bright, timber-lined corridor in a modern building"
          width={1800}
          height={1200}
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="real__copy stagger">
        <SectionIntro num="09" label="Real-world use" />
        <h2 className="h2">
          For the moments that <span className="accent">lead somewhere.</span>
        </h2>
        <p className="lede">
          Taply keeps the focus on the person, not the process.
        </p>
        <ul className="usecases">
          {USE_CASES.map((u, i) => (
            <li key={u}>
              <span className="mono-label">{String(i + 1).padStart(2, '0')}</span>
              {u}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
