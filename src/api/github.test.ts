import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_FILE_BYTES,
  readLibraryFile,
  verifyAccess,
  writeLibraryFile,
  type SyncTarget,
} from './github';
import { encodeBase64 } from '../lib/base64';

const TOKEN = 'github_pat_TESTONLY_not_a_real_token';

const target: SyncTarget = {
  owner: 'reader',
  repo: 'knightshelf-data',
  path: 'library.json',
  token: TOKEN,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function fileResponse(text: string, sha = 'sha-1'): Response {
  return json({ sha, encoding: 'base64', content: encodeBase64(text) });
}

/** Every request made, as [url, init] pairs. */
function requests(): [string, RequestInit][] {
  return fetchMock.mock.calls.map(([url, init]) => [String(url), (init ?? {}) as RequestInit]);
}

describe('credential handling', () => {
  it('sends the token as a bearer header and never in the URL', async () => {
    fetchMock.mockResolvedValue(fileResponse('{}'));
    await readLibraryFile(target);

    for (const [url, init] of requests()) {
      // A token in a URL leaks into history, logs, and Referer headers.
      expect(url).not.toContain(TOKEN);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    }
  });

  it('only ever talks to api.github.com', async () => {
    fetchMock.mockResolvedValue(fileResponse('{}'));
    await readLibraryFile(target);
    await writeLibraryFile(target, '{}', 'sha-1', 'msg');

    for (const [url] of requests()) {
      expect(url.startsWith('https://api.github.com/')).toBe(true);
    }
  });

  it('keeps the token out of error messages', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500, statusText: 'Server Error' }));
    const outcome = await readLibraryFile(target);

    expect(outcome.status).toBe('error');
    if (outcome.status === 'error') expect(outcome.message).not.toContain(TOKEN);
  });

  it('encodes owner, repo and path so they cannot alter the request shape', async () => {
    fetchMock.mockResolvedValue(fileResponse('{}'));
    await readLibraryFile({ ...target, owner: 'a b', repo: 'c/d', path: 'nested/file name.json' });

    const [url] = requests()[0];
    expect(url).toContain('/repos/a%20b/c%2Fd/contents/nested/file%20name.json');
  });
});

describe('readLibraryFile', () => {
  it('decodes the file and returns its revision', async () => {
    fetchMock.mockResolvedValue(fileResponse('{"version":1}', 'abc123'));
    const outcome = await readLibraryFile(target);

    expect(outcome).toEqual({ status: 'ok', text: '{"version":1}', sha: 'abc123' });
  });

  it('round-trips the IPA that plain btoa would choke on', async () => {
    const text = JSON.stringify({ phonetic: '/ˈɡʌnəl/' });
    fetchMock.mockResolvedValue(fileResponse(text));

    const outcome = await readLibraryFile(target);
    expect(outcome.status === 'ok' && outcome.text).toBe(text);
  });

  it('reports an absent file as empty when the repo is reachable', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(json({ private: true }));

    // The distinction matters: this is the ordinary first-run state.
    expect(await readLibraryFile(target)).toEqual({ status: 'empty' });
  });

  it('reports a 404 as no-access when the repo is unreachable too', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }))
      .mockResolvedValueOnce(json({ message: 'Not Found' }, { status: 404 }));

    // Same status code as above, entirely different advice for the user.
    expect(await readLibraryFile(target)).toEqual({ status: 'no-access' });
  });

  it('reports a rejected token as unauthorized', async () => {
    fetchMock.mockResolvedValue(json({ message: 'Bad credentials' }, { status: 401 }));
    expect(await readLibraryFile(target)).toEqual({ status: 'unauthorized' });
  });

  it('distinguishes rate limiting from a permission problem', async () => {
    fetchMock.mockResolvedValue(
      json({}, { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    expect(await readLibraryFile(target)).toEqual({ status: 'rate-limited' });

    fetchMock.mockResolvedValue(json({}, { status: 403 }));
    expect(await readLibraryFile(target)).toEqual({ status: 'no-access' });
  });

  it('reports a file too big for the Contents API', async () => {
    // Past ~1 MB GitHub stops inlining content.
    fetchMock.mockResolvedValue(json({ sha: 'x', encoding: 'none', content: '' }));
    expect(await readLibraryFile(target)).toEqual({
      status: 'too-large',
      limitBytes: MAX_FILE_BYTES,
    });
  });

  it('treats a network failure as offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await readLibraryFile(target)).toEqual({ status: 'offline' });
  });

  it('rejects a response missing the revision', async () => {
    fetchMock.mockResolvedValue(json({ encoding: 'base64', content: encodeBase64('{}') }));
    expect((await readLibraryFile(target)).status).toBe('error');
  });
});

describe('writeLibraryFile', () => {
  const ok = () => json({ content: { sha: 'sha-2' } });

  it('sends the content base64 encoded with the prior revision', async () => {
    fetchMock.mockResolvedValue(ok());
    const outcome = await writeLibraryFile(target, '{"a":1}', 'sha-1', 'Sync');

    expect(outcome).toEqual({ status: 'ok', sha: 'sha-2' });

    const [, init] = requests()[0];
    expect(init.method).toBe('PUT');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.sha).toBe('sha-1');
    expect(body.message).toBe('Sync');
    expect(body.content).toBe(encodeBase64('{"a":1}'));
  });

  it('omits the revision when creating the file', async () => {
    fetchMock.mockResolvedValue(ok());
    await writeLibraryFile(target, '{}', undefined, 'Create');

    const body = JSON.parse(String(requests()[0][1].body)) as Record<string, unknown>;
    expect('sha' in body).toBe(false);
  });

  it.each([409, 422])('treats %i as a conflict to retry', async (status) => {
    fetchMock.mockResolvedValue(json({ message: 'conflict' }, { status }));
    expect(await writeLibraryFile(target, '{}', 'stale', 'Sync')).toEqual({ status: 'conflict' });
  });

  it('refuses an oversized payload without contacting GitHub', async () => {
    const huge = 'x'.repeat(MAX_FILE_BYTES + 1);
    const outcome = await writeLibraryFile(target, huge, 'sha', 'Sync');

    expect(outcome).toMatchObject({ status: 'too-large', limitBytes: MAX_FILE_BYTES });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('measures the limit in bytes, not characters', async () => {
    // Each of these is two UTF-8 bytes, so this is over the limit despite a shorter length.
    const outcome = await writeLibraryFile(target, 'é'.repeat(MAX_FILE_BYTES - 10), 'sha', 'Sync');
    expect(outcome.status).toBe('too-large');
  });

  it('reports a rejected token', async () => {
    fetchMock.mockResolvedValue(json({}, { status: 401 }));
    expect(await writeLibraryFile(target, '{}', 'sha', 'Sync')).toEqual({ status: 'unauthorized' });
  });

  it('treats a network failure as offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await writeLibraryFile(target, '{}', 'sha', 'Sync')).toEqual({ status: 'offline' });
  });

  it('rejects a success response that omits the new revision', async () => {
    fetchMock.mockResolvedValue(json({ content: {} }));
    expect((await writeLibraryFile(target, '{}', 'sha', 'Sync')).status).toBe('error');
  });
});

describe('verifyAccess', () => {
  it('confirms access and reports whether the repo is private', async () => {
    fetchMock.mockResolvedValue(json({ private: true }));
    expect(await verifyAccess(target)).toEqual({ status: 'ok', private: true });

    fetchMock.mockResolvedValue(json({ private: false }));
    expect(await verifyAccess(target)).toEqual({ status: 'ok', private: false });
  });

  it('separates a bad token from an inaccessible repo', async () => {
    fetchMock.mockResolvedValue(json({}, { status: 401 }));
    expect((await verifyAccess(target)).status).toBe('unauthorized');

    fetchMock.mockResolvedValue(json({}, { status: 404 }));
    expect((await verifyAccess(target)).status).toBe('no-access');
  });
});
