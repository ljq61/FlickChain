export interface SaveData {
  schemaVersion: 1;
  completed: string[];
  sound: boolean;
  bestScore: number;
}
type SaveStorage = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'flickchain.progress.v1';
const safeScore = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export class SaveAdapter {
  private storage: SaveStorage | null;
  private readonly knownIds: Set<string>;
  lastError: string | null = null;

  constructor(levelIds: string[], storage?: SaveStorage | null) {
    this.knownIds = new Set(levelIds);
    try {
      this.storage = storage === undefined ? globalThis.localStorage ?? null : storage;
    } catch {
      this.storage = null;
      this.lastError = 'Your browser blocked saving. You can keep playing.';
    }
  }

  read(): SaveData {
    try {
      const raw = this.storage?.getItem(KEY);
      if (!raw) return { schemaVersion: 1, completed: [], sound: true, bestScore: 0 };
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') throw new Error('Invalid save');
      const data = value as Partial<SaveData>;
      if (data.schemaVersion !== 1 || !Array.isArray(data.completed) || typeof data.sound !== 'boolean') {
        throw new Error('Unsupported save');
      }
      return {
        schemaVersion: 1,
        completed: [...new Set(data.completed.filter((id): id is string => typeof id === 'string' && this.knownIds.has(id)))],
        sound: data.sound,
        bestScore: safeScore(data.bestScore),
      };
    } catch {
      this.lastError = 'Saved progress could not be loaded. Using default settings.';
      return { schemaVersion: 1, completed: [], sound: true, bestScore: 0 };
    }
  }

  write(data: SaveData): boolean {
    try {
      if (!this.storage) throw new Error('Storage unavailable');
      const safe: SaveData = {
        schemaVersion: 1,
        completed: [...new Set(data.completed.filter(id => this.knownIds.has(id)))],
        sound: data.sound,
        bestScore: safeScore(data.bestScore),
      };
      this.storage.setItem(KEY, JSON.stringify(safe));
      this.lastError = null;
      return true;
    } catch {
      this.lastError = 'Progress was not saved. You can keep playing, but progress may be lost when you close this page.';
      return false;
    }
  }
}
