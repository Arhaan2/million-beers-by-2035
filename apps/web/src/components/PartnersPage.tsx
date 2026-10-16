import type { DashboardSummary } from '../lib/types';
import { formatInteger } from '../lib/format';
import { ShareActions } from './ShareActions';

function snapshotLabel(summary: DashboardSummary, lastSuccessAt: number | null) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: summary.challenge.timezone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(lastSuccessAt ?? summary.stats.updatedAt));
}
export function ProjectShare({
  summary,
  lastSuccessAt,
}: {
  summary: DashboardSummary;
  lastSuccessAt: number | null;
}) {
  return (
    <ShareActions
      data={{
        title: 'One crew. A shared story.',
        subtitle: `Project record as of ${snapshotLabel(summary, lastSuccessAt)} · ${summary.challenge.timezone}`,
        lines: [
          `${formatInteger(summary.stats.total)} beers recorded · net of corrections`,
          `${formatInteger(summary.stats.entryCount)} saved entries · collective target by 2035`,
        ],
        url: `${window.location.href.split('#')[0]}#/`,
      }}
    />
  );
}
export function PartnersPage({
  summary,
  lastSuccessAt,
}: {
  summary: DashboardSummary | null;
  lastSuccessAt: number | null;
}) {
  return (
    <section className="community-page partners-page">
      <p className="eyebrow">The project, together</p>
      <h2 id="page-title" tabIndex={-1}>
        A shared story, with room for good company.
      </h2>
      <p className="page-intro">
        The Million Beer Project is a crew keeping one collective record through 2035. The number
        connects the project; the familiar people, places and memories give it meaning.
      </p>
      <div className="panel prose">
        <h3>A lasting archive</h3>
        <p>
          Anyone can explore the public record. Crew members use a shared code to save entries,
          credit the people involved and add a little context. Corrections stay in the history, so
          the record can grow without erasing its past.
        </p>
        <p>
          This is a record of what was submitted, not a drinking recommendation or a target for any
          individual.
        </p>
        <div className="button-row">
          <a className="button button--outline" href="#/history">
            Explore the archive
          </a>
          <a className="button button--quiet" href="#/recaps">
            Look through recaps
          </a>
        </div>
      </div>
      <section className="partners-metrics" aria-label="Public project record">
        <h3>The public record today</h3>
        {summary ? (
          <>
            <p className="helper">
              Latest successful snapshot: {snapshotLabel(summary, lastSuccessAt)} (
              {summary.challenge.timezone}). Source: the public project API.
            </p>
            <dl className="partner-stats">
              <div>
                <dt>Net beers recorded</dt>
                <dd>{formatInteger(summary.stats.total)}</dd>
                <p>Signed ledger total, including corrections.</p>
              </div>
              <div>
                <dt>Named contributor records</dt>
                <dd>{formatInteger(summary.stats.crewSize)}</dd>
                <p>
                  Distinct normalized named recipients with a historical positive allocation;
                  Anonymous excluded. Unverified display labels.
                </p>
              </div>
              <div>
                <dt>Saved entries</dt>
                <dd>{formatInteger(summary.stats.entryCount)}</dd>
                <p>
                  Recorded submissions, including corrections and any operational records. Not
                  distinct gatherings.
                </p>
              </div>
            </dl>
            <p className="helper">
              These figures describe the ledger. They do not measure website reach, unique visitors,
              impressions or verified attendance.
            </p>
          </>
        ) : (
          <p>
            The live figures are unavailable. Return when the API connection is restored to see a
            timestamped snapshot.
          </p>
        )}
      </section>
      <div className="panel prose">
        <p className="eyebrow">Possibilities to discuss</p>
        <h3>Small collaborations, shared purpose</h3>
        <p>
          A gathering with a local brewery. Support for a public recap. A partnership around a
          recorded project milestone. These are proposals for a conversation, with scope,
          permissions and responsible-use expectations agreed before anything is published.
        </p>
        <p>
          To talk about the project, contact{' '}
          <a href="mailto:arhaanaggarwal@gmail.com">arhaanaggarwal@gmail.com</a>.
        </p>
        <a href="#/about">More about the project →</a>
      </div>
      {summary ? (
        <>
          <h3>Share the project</h3>
          <ProjectShare summary={summary} lastSuccessAt={lastSuccessAt} />
        </>
      ) : null}
    </section>
  );
}
