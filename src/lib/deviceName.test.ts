import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DEVICE_NAME_LENGTH,
  deviceName,
  generateDeviceName,
  resetDeviceNameCache,
  setDeviceName,
  validateDeviceName,
} from './deviceName';

/** Feeds `generateDeviceName` a fixed run of values so a name can be asserted exactly. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

/** The tests run in node, which has no localStorage. */
function installStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
  });
  return entries;
}

function removeStorage(): void {
  Reflect.deleteProperty(globalThis, 'localStorage');
}

describe('generateDeviceName', () => {
  it('pairs an adjective with an animal, both capitalised', () => {
    expect(generateDeviceName(sequence([0, 0]))).toBe('Amber Otter');
  });

  it('varies with the random source', () => {
    const first = generateDeviceName(sequence([0, 0]));
    const second = generateDeviceName(sequence([0.5, 0.5]));
    expect(second).not.toBe(first);
    expect(second).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  /** A random source returning exactly 1 would index past the end of the list. */
  it('survives a random source that returns 1', () => {
    expect(generateDeviceName(() => 1)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it('always produces a valid name', () => {
    for (let step = 0; step <= 20; step += 1) {
      const name = generateDeviceName(sequence([step / 20, 1 - step / 20]));
      expect(validateDeviceName(name)).toEqual({ ok: true });
    }
  });
});

describe('validateDeviceName', () => {
  it.each(['Pixel 8', 'work-laptop', 'Kitchen iPad 2', 'Ordinateur', 'ノートパソコン', 'x'])(
    'accepts %j',
    (name) => {
      expect(validateDeviceName(name)).toEqual({ ok: true });
    },
  );

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['a\nb', 'a newline'],
    ['ab', 'a control character'],
    ['desk/top', 'a slash'],
    ['my_laptop', 'an underscore'],
    ["Ada's phone", 'an apostrophe'],
    ['emoji 🎉', 'an emoji'],
  ])('rejects %j — %s', (name) => {
    expect(validateDeviceName(name).ok).toBe(false);
  });

  it('rejects a name past the length cap but accepts one at it', () => {
    const atCap = 'a'.repeat(MAX_DEVICE_NAME_LENGTH);
    expect(validateDeviceName(atCap)).toEqual({ ok: true });
    expect(validateDeviceName(`${atCap}a`).ok).toBe(false);
  });

  it('measures the trimmed name, so surrounding spaces are not an error', () => {
    expect(validateDeviceName(`  ${'a'.repeat(MAX_DEVICE_NAME_LENGTH)}  `)).toEqual({ ok: true });
  });

  it('explains why it refused', () => {
    const outcome = validateDeviceName('nope!');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.message.length).toBeGreaterThan(0);
  });
});

describe('deviceName', () => {
  let entries: Map<string, string>;

  beforeEach(() => {
    entries = installStorage();
    resetDeviceNameCache();
  });

  afterEach(() => {
    removeStorage();
    resetDeviceNameCache();
  });

  it('generates and persists a name on first use', () => {
    const name = deviceName();

    expect(validateDeviceName(name)).toEqual({ ok: true });
    expect(entries.get('knightshelf.device')).toBe(name);
  });

  /** The whole point of an identity: it must not move between syncs. */
  it('returns the same name on every later call', () => {
    const first = deviceName();
    resetDeviceNameCache();

    expect(deviceName()).toBe(first);
  });

  it('reads a name stored by an earlier session', () => {
    entries.set('knightshelf.device', 'Pixel 8');

    expect(deviceName()).toBe('Pixel 8');
  });

  it('replaces a blank stored value rather than returning it', () => {
    entries.set('knightshelf.device', '   ');

    expect(deviceName().trim().length).toBeGreaterThan(0);
  });

  it('persists a rename', () => {
    deviceName();
    setDeviceName('  Kitchen iPad  ');

    expect(deviceName()).toBe('Kitchen iPad');
    expect(entries.get('knightshelf.device')).toBe('Kitchen iPad');
  });

  it('ignores a rename to nothing', () => {
    const before = deviceName();
    setDeviceName('   ');

    expect(deviceName()).toBe(before);
  });

  /**
   * The sync engine asks for this while building a commit message, so it has to answer
   * even where storage is unavailable — a private-mode window must still be able to push.
   */
  it('still returns a name with no storage at all', () => {
    removeStorage();
    resetDeviceNameCache();

    expect(validateDeviceName(deviceName())).toEqual({ ok: true });
  });
});
