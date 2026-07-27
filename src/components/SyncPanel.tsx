import { useState } from 'react';
import { useSync } from '../state/SyncContext';
import { DEFAULT_PATH } from '../state/syncConfig';
import type { SyncReport } from '../lib/syncEngine';

/**
 * Sync setup and status.
 *
 * Every failure gets a specific sentence and, where one exists, the action that fixes
 * it. The states this guards against being indistinguishable are "your token expired",
 * "that repo doesn't exist", and "you're offline" — all of which arrive from GitHub as
 * bare status codes, and all of which need entirely different responses.
 */

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

interface Message {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
  /** Extra detail worth a second line. */
  detail?: string;
}

function describeReport(report: SyncReport): Message {
  switch (report.status) {
    case 'synced': {
      const { stats } = report;
      const incoming = stats.wordsAdded + stats.booksAdded;
      const detail: string[] = [];

      if (incoming > 0 && report.pulled) {
        detail.push(
          `Brought in ${stats.wordsAdded} ${stats.wordsAdded === 1 ? 'word' : 'words'} from another device.`,
        );
      }
      if (stats.deletionsApplied > 0) {
        detail.push(
          `${stats.deletionsApplied} ${stats.deletionsApplied === 1 ? 'removal was' : 'removals were'} applied here too.`,
        );
      }
      if (stats.orphanedWords > 0) {
        detail.push(
          `${stats.orphanedWords} ${stats.orphanedWords === 1 ? 'word belongs' : 'words belong'} to a book removed on another device — hidden, but not deleted.`,
        );
      }

      return {
        tone: 'ok',
        text: report.pushed || report.pulled ? 'Synced.' : 'Already up to date.',
        detail: detail.join(' ') || undefined,
      };
    }

    case 'unauthorized':
      return {
        tone: 'bad',
        text: 'GitHub rejected the token.',
        detail: 'It has probably expired or been revoked. Create a new one and reconnect.',
      };

    case 'no-access':
      return {
        tone: 'bad',
        text: "That repository can't be reached with this token.",
        detail:
          'Check the owner and name, and that the token grants Contents access to exactly this repository.',
      };

    case 'offline':
      return {
        tone: 'warn',
        text: 'No connection.',
        detail: 'Your words are safe on this device and will sync when you are back online.',
      };

    case 'rate-limited':
      return {
        tone: 'warn',
        text: 'GitHub is rate limiting requests.',
        detail: 'Nothing is lost. Syncing will resume shortly.',
      };

    case 'too-large':
      return {
        tone: 'bad',
        text: 'Your library has outgrown this sync method.',
        detail: `The file would be ${report.bytes ? `${Math.round(report.bytes / 1024)} KB` : 'over the limit'}, and the limit is ${Math.round(report.limitBytes / 1024)} KB. Syncing needs upgrading to handle larger files — your words are untouched.`,
      };

    case 'app-outdated':
      return {
        tone: 'bad',
        text: 'Another device synced using a newer version of the app.',
        detail:
          'Nothing was changed here, to avoid discarding data this version does not understand. Update this device, then sync again.',
      };

    case 'remote-invalid':
      return {
        tone: 'bad',
        text: 'The synced file could not be read.',
        detail: `${report.message} Nothing was overwritten — the file is left exactly as it was.`,
      };

    case 'conflict-unresolved':
      return {
        tone: 'warn',
        text: 'Another device kept writing while this one tried to sync.',
        detail: `Gave up after ${report.attempts} attempts rather than overwriting it. Nothing was lost; try again.`,
      };

    case 'error':
      return { tone: 'bad', text: 'Sync failed.', detail: report.message };
  }
}

function formatWhen(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (seconds < 86400) {
    const hours = Math.round(seconds / 3600);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const TONE_BORDER: Record<Message['tone'], string> = {
  ok: 'border-rule',
  warn: 'border-rule-strong',
  bad: 'border-rubric',
};

export function SyncPanel() {
  const { activity, repo, lastReport, lastSyncedAt, repoIsPublic, connect, disconnect, syncNow } =
    useSync();

  const [showForm, setShowForm] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const configured = activity !== 'unconfigured';
  const message = lastReport ? describeReport(lastReport) : null;

  async function submit(): Promise<void> {
    if (connecting) return;
    setConnecting(true);
    setFormError(null);

    const outcome = await connect(repoInput, tokenInput);

    switch (outcome.status) {
      case 'ok':
        // Never keep the pasted credential in component state.
        setTokenInput('');
        setRepoInput('');
        setShowForm(false);
        break;
      case 'invalid-repo':
        setFormError('That does not look like a repository. Use the form owner/repository.');
        break;
      case 'missing-token':
        setFormError('Paste the token you generated on GitHub.');
        break;
      case 'unauthorized':
        setFormError('GitHub rejected that token. Check you copied all of it, and that it has not expired.');
        break;
      case 'no-access':
        setFormError(
          "That repository isn't visible to this token. Confirm the name, and that the token selects this repository with Contents access.",
        );
        break;
      case 'offline':
        setFormError('No connection to GitHub. Try again once you are online.');
        break;
      case 'rate-limited':
        setFormError('GitHub is rate limiting requests. Try again in a few minutes.');
        break;
      case 'error':
        setFormError(outcome.message);
        break;
    }

    setConnecting(false);
  }

  return (
    <section className="py-7">
      <h2 className="label">Sync</h2>

      {!configured && !showForm && (
        <>
          <p className="mt-2.5 leading-relaxed text-ink-soft">
            Keep one shelf across every device by storing your words in a private GitHub
            repository. Nothing is public, and no other service is involved.
          </p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="mt-4 min-h-11 border border-rule px-4 transition-colors hover:border-rubric hover:text-rubric"
          >
            <span className="label text-current">Set up sync</span>
          </button>
        </>
      )}

      {!configured && showForm && (
        <div className="mt-3 space-y-4">
          <button
            type="button"
            onClick={() => setShowHelp((value) => !value)}
            aria-expanded={showHelp}
            className="label text-rubric transition-opacity hover:opacity-70"
          >
            {showHelp ? 'Hide the steps' : 'What do I need first?'}
          </button>

          {showHelp && (
            <ol className="animate-rise space-y-2 border-l-2 border-rule pl-3.5 text-sm leading-relaxed text-ink-soft">
              <li>
                <span className="text-ink">1.</span> Create a new <strong>private</strong>{' '}
                repository on GitHub — an empty one. The file is created for you.
              </li>
              <li>
                <span className="text-ink">2.</span> Generate a{' '}
                <a
                  href={TOKEN_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-rubric underline decoration-rubric/40"
                >
                  fine-grained token
                </a>
                . Under <em>Repository access</em> choose <strong>Only select repositories</strong>{' '}
                and pick that one repository. Under <em>Permissions</em> set{' '}
                <strong>Contents</strong> to <strong>Read and write</strong>. Nothing else.
              </li>
              <li>
                <span className="text-ink">3.</span> Copy the token and paste it below. GitHub
                shows it once.
              </li>
              <li className="text-ink-faint">
                The token is stored only in this browser and sent only to GitHub. Because it
                reaches one repository and nothing else, a leak exposes your word list and no
                more.
              </li>
            </ol>
          )}

          <label className="block">
            <span className="label">Repository</span>
            <input
              value={repoInput}
              onChange={(event) => setRepoInput(event.target.value)}
              placeholder="your-name/knightshelf-data"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 font-mono text-sm outline-none focus:border-rubric"
            />
          </label>

          <label className="block">
            <span className="label">Token</span>
            <input
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              type="password"
              placeholder="github_pat_…"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 font-mono text-sm outline-none focus:border-rubric"
            />
            <span className="label mt-1.5 block !normal-case !tracking-normal">
              Stored in this browser only. Never written to the repository.
            </span>
          </label>

          {formError && (
            <p className="border-l-2 border-rubric bg-rubric-tint px-3.5 py-2.5 text-sm">
              {formError}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setTokenInput('');
                setFormError(null);
              }}
              className="min-h-11 flex-1 border border-rule px-4 text-sm transition-colors hover:bg-paper-sunk"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={connecting}
              className="min-h-11 flex-1 bg-rubric px-4 text-sm text-paper-raised transition-opacity disabled:opacity-40"
            >
              {connecting ? 'Checking…' : 'Connect'}
            </button>
          </div>
        </div>
      )}

      {configured && repo && (
        <div className="mt-3 space-y-3">
          <p className="font-mono text-sm text-ink-soft">
            {repo.owner}/{repo.repo}
            {repo.path !== DEFAULT_PATH ? ` · ${repo.path}` : ''}
          </p>

          {repoIsPublic && (
            <p className="border-l-2 border-rubric bg-rubric-tint px-3.5 py-2.5 text-sm">
              <strong>That repository is public.</strong> Anyone can read your words. Make it
              private in the repository settings on GitHub.
            </p>
          )}

          <p className="label !normal-case !tracking-normal">
            {activity === 'syncing'
              ? 'Syncing…'
              : lastSyncedAt
                ? `Last synced ${formatWhen(lastSyncedAt)}`
                : 'Not synced yet'}
          </p>

          {message && (
            <div className={`border-l-2 ${TONE_BORDER[message.tone]} pl-3.5 text-sm`}>
              <p className={message.tone === 'bad' ? 'text-rubric' : 'text-ink-soft'}>
                {message.text}
              </p>
              {message.detail && <p className="mt-1 text-ink-soft">{message.detail}</p>}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void syncNow()}
              disabled={activity === 'syncing'}
              className="min-h-11 flex-1 border border-rule px-4 text-sm transition-colors hover:border-rubric hover:text-rubric disabled:opacity-40"
            >
              {activity === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>

            {confirmingDisconnect ? (
              <button
                type="button"
                onClick={() => {
                  disconnect();
                  setConfirmingDisconnect(false);
                }}
                className="min-h-11 flex-1 bg-rubric px-4 text-sm text-paper-raised"
              >
                Forget the token
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDisconnect(true)}
                className="min-h-11 flex-1 border border-rule px-4 text-sm transition-colors hover:bg-paper-sunk"
              >
                Disconnect
              </button>
            )}
          </div>

          {confirmingDisconnect && (
            <p className="text-sm text-ink-soft">
              This removes the token from this browser. Your words stay here and stay in the
              repository — revoke the token on GitHub if you want it dead everywhere.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
