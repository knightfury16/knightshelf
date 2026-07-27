import { describe, expect, it } from 'vitest';
import { DEFAULT_PATH, parseRepoInput } from './syncConfig';

describe('parseRepoInput', () => {
  it('accepts the plain owner/repo form', () => {
    expect(parseRepoInput('knightfury16/knightshelf-data')).toEqual({
      owner: 'knightfury16',
      repo: 'knightshelf-data',
      path: DEFAULT_PATH,
    });
  });

  it.each([
    'https://github.com/reader/data',
    'http://github.com/reader/data',
    'github.com/reader/data',
    'https://github.com/reader/data.git',
    'git@github.com:reader/data.git',
    '  reader/data  ',
    '/reader/data/',
  ])('accepts %s, since that is what people paste', (input) => {
    expect(parseRepoInput(input)).toMatchObject({ owner: 'reader', repo: 'data' });
  });

  it('keeps a custom file path but defaults when blank', () => {
    expect(parseRepoInput('a/b', 'words/library.json')?.path).toBe('words/library.json');
    expect(parseRepoInput('a/b', '   ')?.path).toBe(DEFAULT_PATH);
  });

  it.each([
    ['empty input', ''],
    ['only whitespace', '   '],
    ['no repository', 'reader'],
    ['too many segments', 'reader/data/extra'],
    ['an invalid owner', 'read er/data'],
    ['an invalid repo name', 'reader/da ta'],
  ])('rejects %s rather than guessing', (_label, input) => {
    expect(parseRepoInput(input)).toBeNull();
  });

  it('allows dots and underscores in a repository name', () => {
    expect(parseRepoInput('reader/my_data.v2')).toMatchObject({ repo: 'my_data.v2' });
  });
});
