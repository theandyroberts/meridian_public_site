import { GlobeMark, Logo } from "@/components/Logo";

export function ComingSoon() {
  return (
    <main className="coming-soon">
      <div className="coming-soon-grid" aria-hidden="true" />
      <div className="coming-soon-orbit" aria-hidden="true">
        <GlobeMark size={720} />
      </div>
      <section className="coming-soon-content">
        <Logo />
        <div className="coming-soon-horizon" />
        <p className="mono accent">360×180 environments</p>
        <h1>
          See the world
          <br />
          before you shoot it.
        </h1>
        <p className="coming-soon-lede">
          Production-ready environments for LED volumes, virtual production,
          and the stories that need a world outside the frame.
        </p>
        <p className="mono coming-soon-status">
          The new Plate Lab is coming soon
        </p>
      </section>
      <p className="mono coming-soon-footer">© 2026 The Plate Lab</p>
    </main>
  );
}
