import { useEffect, useState } from 'react';
const dismissedKey = 'million-beers:install-guidance-dismissed';
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export function InstallGuidance() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey) === 'yes';
    } catch {
      return false;
    }
  });
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const connection = () => setOnline(navigator.onLine);
    const install = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    };
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('beforeinstallprompt', install);
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('beforeinstallprompt', install);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(
        choice.outcome === 'accepted'
          ? 'Home-screen installation accepted.'
          : 'Installation canceled.',
      );
    } catch {
      setMessage('Use your browser’s menu to add the project to your home screen.');
    }
    setPrompt(null);
  };
  return (
    <aside className="install-guidance" aria-label="Phone and connection help">
      {!online ? (
        <p className="offline-notice" role="status">
          You’re offline. Reconnect to read fresh records or save. Your saved draft stays on this
          device; nothing is submitted automatically.
        </p>
      ) : null}
      {!dismissed ? (
        <details>
          <summary>Keep the project close on your phone</summary>
          <p>
            Add this page to your home screen from your browser’s menu. On iPhone or iPad, open
            Safari’s Share menu and choose Add to Home Screen. Options vary by browser.
          </p>
          <p>
            An internet connection is required to open the project and fetch or save records. Saved
            drafts are local to this browser. Reconnecting never submits them automatically.
          </p>
          <div className="button-row">
            {prompt ? (
              <button className="button button--outline" onClick={() => void install()}>
                Add to home screen
              </button>
            ) : null}
            <button
              className="button button--quiet"
              onClick={() => {
                setDismissed(true);
                try {
                  localStorage.setItem(dismissedKey, 'yes');
                } catch {
                  /* Dismiss for this visit. */
                }
              }}
            >
              Dismiss installation guidance
            </button>
          </div>
          <p role="status">{message}</p>
        </details>
      ) : null}
    </aside>
  );
}
