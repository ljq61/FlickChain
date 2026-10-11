import type { BattleVariant, CoinConfig, CoinTransform, LevelConfig, ObstacleConfig, TableConfig } from '../types/contracts';
import { coinRadius, PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { tableClearance } from '../physics/TableGeometry';
import { obstacleDistance, validateLevel } from './LevelValidator';
import { GLASS_DIAMETER } from './CampaignGenerator';

/** All positions and dimensions are metres. Battle always starts with nine public coins. */
export const BATTLE_COIN_COUNT = 9;
export const OPENING_START_Z = 0.64;
const GAP = 0.012;
let sequence = 0;
type Point = { x: number; z: number };
function unit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) throw new Error('对战随机数必须为有限数字');
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
function place(table: TableConfig, random: () => number, accepts: (point: Point) => boolean): Point {
  const radius = Math.min(table.width, table.depth) / 2 - 0.09;
  for (let attempt = 0; attempt < 96; attempt++) {
    const r = Math.sqrt(unit(random)) * radius, angle = unit(random) * Math.PI * 2;
    const point = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    if (accepts(point)) return point;
  }
  // Finite fallback guarantees constant RNG cannot stall generation or silently reduce counts.
  for (let ring = 0; ring <= 14; ring++) for (let step = 0; step < 96; step++) {
    const r = radius * ring / 14, angle = step * Math.PI / 48;
    const point = { x: Math.cos(angle) * r, z: Math.sin(angle) * r };
    if (accepts(point)) return point;
  }
  throw new Error('对战桌面没有足够的安全生成位置');
}
function addCoins(table: TableConfig, coins: CoinConfig[], obstacles: ObstacleConfig[], random: () => number,
  nextId: () => string, targetCount = BATTLE_COIN_COUNT): void {
  while (coins.length < targetCount) {
    const materialId = unit(random) < 0.5 ? 'standard' : 'iron';
    const radius = coinRadius(materialId);
    const point = place(table, random, (p) => tableClearance(table, p.x, p.z) > radius + PHYSICS_CONFIG.initialClearance
      && coins.every((coin) => distance(p, coin) > radius + coinRadius(coin.materialId) + GAP)
      && obstacles.every((glass) => obstacleDistance(glass, p.x, p.z) > radius + GAP));
    coins.push({ id: nextId(), materialId, ...point });
  }
}
export function generateBattle(random: () => number = Math.random): LevelConfig {
  const prefix = `battle-${++sequence}`;
  const table: TableConfig = { shape: 'circle', width: 1.6, depth: 1.6, materialId: unit(random) < 0.5 ? 'wood' : 'marble' };
  const count = 1 + Math.floor(unit(random) * 5);
  const obstacles: ObstacleConfig[] = [];
  for (let index = 0; index < count; index++) {
    const point = place(table, random, (p) => tableClearance(table, p.x, p.z) > GLASS_DIAMETER / 2 + GAP
      && obstacles.every((glass) => distance(p, glass) > GLASS_DIAMETER + GAP));
    obstacles.push({ id: `${prefix}-glass-${index}`, kind: 'glass', width: GLASS_DIAMETER, depth: GLASS_DIAMETER, ...point });
  }
  const coins: CoinConfig[] = [];
  addCoins(table, coins, obstacles, random, () => `${prefix}-coin-${coins.length}`);
  return validateLevel({ schemaVersion: 1, id: prefix, name: '本地对战', lesson: '失误换手，先得 10 分获胜',
    table, obstacles, coins, activeCoinId: coins[0].id });
}
/** Keep the settled board: PVP fills to nine; PVE adds exactly eight new coins. */
export function generateBattleRefill(level: LevelConfig, retained: CoinTransform[], random: () => number = Math.random,
  variant: BattleVariant = 'pvp'): LevelConfig {
  if (variant !== 'pvp' && variant !== 'pve') throw new Error('无效对战类型');
  if (retained.length > 1) throw new Error('对战补币只能保留零或一枚存活硬币');
  const prefix = `battle-${++sequence}-refill`;
  const table = { ...level.table }, obstacles = level.obstacles.map((glass) => ({ ...glass }));
  const coins: CoinConfig[] = retained.map(({ id, materialId, position }) => {
    if (!id || (materialId !== 'standard' && materialId !== 'iron') || ![position.x, position.z].every(Number.isFinite)
      || tableClearance(table, position.x, position.z) <= 0) throw new Error('对战存活硬币无效');
    return { id, materialId, x: position.x, z: position.z };
  });
  const reserved = new Set([...level.coins, ...obstacles, ...coins].map((item) => item.id));
  let index = 0;
  const nextId = () => {
    let id: string;
    do { id = `${prefix}-coin-${index++}`; } while (reserved.has(id));
    reserved.add(id); return id;
  };
  addCoins(table, coins, obstacles, random, nextId, variant === 'pve' ? retained.length + 8 : BATTLE_COIN_COUNT);
  return validateLevel({ ...level, id: prefix, coins, table, obstacles, activeCoinId: coins[0].id },
    new Set(retained.map((coin) => coin.id)), new Set(obstacles.map((glass) => glass.id)));
}
export function generateOpening(table: TableConfig): LevelConfig {
  const id = `battle-${++sequence}-opening`;
  return validateLevel({ schemaVersion: 1, purpose: 'opening', id, name: '先手比较', lesson: '同一底侧起点，弹得更远且不落桌者先手',
    table: { ...table }, obstacles: [], coins: [{ id: `${id}-gold`, materialId: 'standard', x: 0, z: OPENING_START_Z }],
    activeCoinId: `${id}-gold` });
}
