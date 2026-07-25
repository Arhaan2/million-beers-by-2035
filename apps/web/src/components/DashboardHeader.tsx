interface Props {
  loggedIn: boolean;
  degraded: boolean;
  lastSuccessAt: number | null;
  onLogin: () => void;
  onAdd: () => void;
  onLogout: () => void;
}

export function DashboardHeader({
  loggedIn,
  degraded,
  lastSuccessAt,
  onLogin,
  onAdd,
  onLogout,
}: Props) {
  return (
    <header className="site-header">
      <div className="brand-lockup">
        <div className="mug-mark" aria-hidden="true">
          <svg viewBox="0 0 48 48" role="img">
            <path d="M9 14h25v26H15a6 6 0 0 1-6-6V14Z" />
            <path d="M34 20h4a6 6 0 0 1 0 12h-4" />
            <path d="M13 14c0-4 5-7 9-3 3-5 10-3 10 3" />
            <path d="M17 21v12M25 21v12" />
          </svg>
        </div>
        <div>
          <p className="eyebrow">One crew · one impossible number</p>
          <h1>The Million Beer Project</h1>
          <p className="subtitle">One crew. One impossible number. By 2035.</p>
        </div>
      </div>
      <div className="header-actions">
        <p className={`connection ${degraded ? 'connection--degraded' : ''}`} role="status">
          <span aria-hidden="true" />
          {degraded
            ? 'Connection degraded'
            : lastSuccessAt
              ? `Updated ${new Intl.DateTimeFormat('en', { timeStyle: 'short' }).format(lastSuccessAt)}`
              : 'Connecting'}
        </p>
        {loggedIn ? (
          <div className="button-row">
            <button className="button button--primary" onClick={onAdd}>
              Add beers
            </button>
            <button className="button button--quiet" onClick={onLogout}>
              Log out
            </button>
          </div>
        ) : (
          <button className="button button--outline" onClick={onLogin}>
            Crew login
          </button>
        )}
      </div>
    </header>
  );
}
