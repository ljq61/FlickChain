export type Vec3 = { x: number; y: number; z: number };
export type Quaternion = { x: number; y: number; z: number; w: number };
export type Direction = { x: number; z: number };
export type GameMode = 'challenge' | 'battle';
export type BattleVariant = 'pvp' | 'pve';
export type BattleWinScore = 10;
export type GamePhase = 'ready' | 'selecting' | 'simulating' | 'refilling' | 'failed' | 'complete' | 'paused' | 'error';
export type CoinMaterialId = 'standard' | 'iron';
export type TableMaterialId = 'wood' | 'marble';

export interface CoinConfig {
  id: string;
  x: number;
  z: number;
  materialId: CoinMaterialId;
}
export interface ObstacleConfig {
  /** Omitted kind retains legacy rectangular obstacles. Glass uses a solid cylindrical footprint. */
  kind?: 'box' | 'glass';
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  rotation?: number;
}
export interface TableConfig {
  width: number;
  depth: number;
  materialId: TableMaterialId;
  /** Missing shape preserves legacy rectangular content. Circle uses width=depth=diameter. */
  shape?: 'rectangle' | 'circle';
}
export interface LevelConfig {
  schemaVersion: 1;
  /** A single gold coin on an empty table, used only to compare opening distances. */
  purpose?: 'opening';
  id: string;
  name: string;
  lesson: string;
  table: TableConfig;
  coins: CoinConfig[];
  activeCoinId: string;
  obstacles: ObstacleConfig[];
}
export interface CoinTransform {
  id: string;
  materialId: CoinMaterialId;
  position: Vec3;
  rotation: Quaternion;
}
export interface WorldFrame {
  coins: CoinTransform[];
  table: LevelConfig['table'];
  obstacles: ObstacleConfig[];
}
export type FoulReason = 'MISS' | 'MULTI_HIT' | 'FALL' | 'TIMEOUT';
export interface ShotFacts {
  sourceCoinId: string;
  contacts: [string, string][];
  fallenCoinIds: string[];
  timedOut: boolean;
}
export type ShotResult =
  | { outcome: 'SUCCESS'; sourceCoinId: string; targetCoinId: string; reasons: [] }
  | { outcome: 'FOUL'; sourceCoinId: string; reasons: FoulReason[] };
export interface GameView {
  sessionId: string;
  revision: number;
  mode: GameMode;
  phase: GamePhase;
  levelId: string;
  activeCoinId: string | null;
  /** Public launch choice remains open until the first shot of this player's turn. */
  canSelectCoin: boolean;
  currentPlayer: 0 | 1;
  scores: [number, number];
  remaining: number;
  chain: number;
  shotCount: number;
  foulReasons: FoulReason[];
  lastResult: ShotResult | null;
  winner: 0 | 1 | 'draw' | null;
  error: string | null;
  /** App adds local opponent/phase information; Core still owns score and turn. */
  battle?: BattleView;
  inputOwner?: 'human' | 'computer';
  /** Persisted with Core snapshots so Battle searches use the same ten-point goal. */
  battleWinScore?: BattleWinScore;
}
export interface BattleView {
  variant: BattleVariant;
  stage: 'opening' | 'playing';
  distances: [number | null, number | null];
  fallen: [boolean, boolean];
  openingAttempt: number;
}
export interface AimPreview {
  source: Vec3;
  direction: Direction;
  power: number;
}

/** Continuous Challenge presentation metadata. Round zero is the home/battle surface. */
export interface CampaignView {
  round: number;
  score: number;
  bestScore: number;
  revivesRemaining: number;
  transition: 'clearing' | 'arriving' | null;
  tutorial?: string;
}
