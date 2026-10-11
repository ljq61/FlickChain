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
      this.lastError = '浏览器未允许保存进度，本次仍可正常游玩。';
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
      this.lastError = '旧进度无法读取，已恢复默认设置。';
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
      this.lastError = '进度暂未保存；可继续游玩，关闭页面后可能丢失。';
      return false;
    }
  }
}
