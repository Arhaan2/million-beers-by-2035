interface Props {
  hasSavedAttempt: boolean;
  onRecord: () => void;
}

export function ProjectCover({ hasSavedAttempt, onRecord }: Props) {
  return (
    <section className="project-cover" aria-labelledby="page-title">
      <div className="project-cover__inner">
        <div className="project-cover__copy gather-panel">
          <p className="project-dateline">
            <span aria-hidden="true" /> Recording since July 2026
          </p>
          <h1 id="page-title" tabIndex={-1}>
            One million beers.
            <br />
            <em>By 2035.</em>
          </h1>
          <p className="project-cover__intro">
            One crew keeping a public record of the beers, the people, and the places along the way.
          </p>
          <div className="cover-actions">
            <button className="button cover-record" onClick={onRecord}>
              <span className="plus-mark" aria-hidden="true">
                +
              </span>
              {hasSavedAttempt ? 'Resolve saved submission' : 'Record entry'}
            </button>
            <a href="#/history">Browse history</a>
          </div>
        </div>
        <div className="cover-art">
          <img
            src={`${import.meta.env.BASE_URL}ledger-coasters.webp`}
            width="1200"
            height="800"
            alt="A stack of Million Beer Project coasters stamped with two clinking mugs and the year 2035."
            fetchPriority="high"
          />
        </div>
      </div>
    </section>
  );
}
