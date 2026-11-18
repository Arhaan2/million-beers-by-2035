import type { ReactNode } from 'react';

interface Props {
  section: string;
  loggedIn: boolean;
  onLogin: () => void;
  onAdd: () => void;
  onLogout: () => void;
}

export function ConnectionStatus({
  degraded,
  lastSuccessAt,
}: {
  degraded: boolean;
  lastSuccessAt: number | null;
}) {
  return (
    <p
      className={`ledger-status${degraded ? ' ledger-status--delayed' : lastSuccessAt ? ' ledger-status--live' : ''}`}
      role="status"
    >
      <span aria-hidden="true" />
      {degraded
        ? 'Connection degraded'
        : lastSuccessAt
          ? `Updated ${new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(lastSuccessAt)}`
          : 'Connecting'}
    </p>
  );
}

export function ProjectMark() {
  return (
    <img
      className="project-mark"
      alt=""
      width="46"
      height="46"
      src={`${import.meta.env.BASE_URL}app-icon.svg`}
    />
  );
}

function LoginIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      aria-hidden="true"
    >
      <circle cx="10" cy="6.3" r="3.1" />
      <path d="M3.7 16.3c.5-3.3 2.6-5 6.3-5s5.8 1.7 6.3 5" strokeLinecap="round" />
    </svg>
  );
}

const destinations = [
  ['', 'Dashboard'],
  ['crew', 'Crew'],
  ['history', 'History'],
  ['recaps', 'Recaps'],
  ['about', 'About'],
] as const;

export function DashboardHeader({ section, loggedIn, onLogin, onAdd, onLogout }: Props) {
  const Name = section ? 'h1' : 'span';
  const auth: ReactNode = loggedIn ? (
    <>
      <button className="button button--primary" onClick={onAdd}>
        Record entry
      </button>
      <button className="button button--quiet" onClick={onLogout}>
        Log out
      </button>
    </>
  ) : (
    <button className="button button--outline crew-login" onClick={onLogin}>
      <LoginIcon /> Crew login
    </button>
  );
  return (
    <header className="ledger-header">
      <div className="ledger-header__inner">
        <a className="project-brand" href="#/" aria-label="The Million Beer Project dashboard">
          <ProjectMark />
          <Name className="project-wordmark">
            The Million
            <br />
            Beer Project
          </Name>
        </a>
        <nav className="ledger-nav" aria-label="Main navigation">
          {destinations.map(([slug, label]) => (
            <a
              key={slug}
              href={`#/${slug}`}
              aria-current={
                section === slug ||
                (slug === 'crew' && section === 'member') ||
                (slug === 'history' && section === 'entry')
                  ? 'page'
                  : undefined
              }
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="ledger-auth">{auth}</div>
      </div>
    </header>
  );
}
