import type { CoinConfig, CoinMaterialId, CoinTransform, LevelConfig, ObstacleConfig, TableConfig } from '../types/contracts';
import { coinRadius, PHYSICS_CONFIG } from '../physics/MaterialRegistry';
import { tableClearance } from '../physics/TableGeometry';
import { obstacleDistance } from './LevelValidator';

/** Metres from an existing coin's centre. Applies to round carry and revival. */
export const RETAINED_COIN_EXCLUSION = 0.16;
/** Conservative first-target centre distances for the heaviest coin on the roughest table. */
export const OPENING_TARGET_MIN_DISTANCE = 0.20;
export const OPENING_TARGET_MAX_DISTANCE = 0.55;
export const GLASS_DIAMETER = 0.14;
const GLASS_CENTRE_RADIUS = 0.42;
const RANDOM_ATTEMPTS = 96;
const PLACEMENT_GAP = 0.012;
let generation = 0;

type Point = { x: number; z: number };

function unit(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value)) throw new Error('关卡随机数必须为有限数字');
  return Math.max(0, Math.min(1 - Number.EPSILON, value));
}
function integer(min: number, max: number, random: () => number): number {
  return min + Math.floor(unit(random) * (max - min + 1));
}
function polar(radius: number, angle: number): Point {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}
function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function pathDistance(point: Point, path: [Point, Point]): number {
  const [start, end] = path;
  const dx = end.x - start.x, dz = end.z - start.z;
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / (dx * dx + dz * dz)));
  return distance(point, { x: start.x + t * dx, z: start.z + t * dz });
}
/** A bounded grid also works with a constant random source. No count is silently reduced. */
function place(randomPoint: () => Point, accepts: (point: Point) => boolean, radii: number[]): Point {
  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
    const point = randomPoint();
    if (accepts(point)) return point;
  }
  for (const radius of radii) for (let angle = 0; angle < 72; angle++) {
    const point = polar(radius, angle * Math.PI / 36);
    if (accepts(point)) return point;
  }
  throw new Error('桌面没有足够的安全位置生成指定数量的硬币或玻璃杯');
}
function retainedCoins(retained: CoinTransform[], table: TableConfig): CoinConfig[] {
  const ids = new Set<string>();
  return retained.map((coin) => {
    if (!coin.id || ids.has(coin.id)) throw new Error('存活硬币 ID 为空或重复');
    ids.add(coin.id);
    if (coin.materialId !== 'standard' && coin.materialId !== 'iron') throw new Error('未知存活硬币材质');
    const { x, z } = coin.position;
    if (!Number.isFinite(x) || !Number.isFinite(z) || tableClearance(table, x, z) <= 0) {
      throw new Error('存活硬币中心必须在桌面内');
    }
    return { id: coin.id, x, z, materialId: coin.materialId };
  });
}
function idFactory(reserved: Iterable<string>, prefix: string): (kind: string) => string {
  const ids = new Set(reserved);
  let index = 0;
  return (kind) => {
    let id: string;
    do { id = `${prefix}-${kind}-${index++}`; } while (ids.has(id));
    ids.add(id);
    return id;
  };
}
function addCoins(table: TableConfig, retained: CoinConfig[], obstacles: ObstacleConfig[], materials: CoinMaterialId[],
  random: () => number, id: (kind: string) => string, edgeCount = 0, clearPath?: [CoinConfig, CoinConfig], openingSource?: CoinConfig): CoinConfig[] {
  if (retained.length + materials.length > PHYSICS_CONFIG.maxCoins) throw new Error('关卡硬币数量超过支持上限');
  const coins = retained.map((coin) => ({ ...coin }));
  const tableRadius = Math.min(table.width, table.depth) / 2;
  const fallbackRadii = Array.from({ length: 14 }, (_, i) => i * tableRadius / 15);
  for (const [index, materialId] of materials.entries()) {
    const radius = coinRadius(materialId);
    const isEdge = index < edgeCount;
    const maxRadius = tableRadius - radius - PHYSICS_CONFIG.initialClearance - PLACEMENT_GAP;
    const accepts = (point: Point) => tableClearance(table, point.x, point.z) > radius + PHYSICS_CONFIG.initialClearance
      && (!openingSource || (distance(point, openingSource) >= OPENING_TARGET_MIN_DISTANCE && distance(point, openingSource) <= OPENING_TARGET_MAX_DISTANCE))
      && retained.every((coin) => distance(point, coin) > RETAINED_COIN_EXCLUSION)
      && coins.every((coin) => distance(point, coin) > radius + coinRadius(coin.materialId) + PLACEMENT_GAP)
      && (!clearPath || pathDistance(point, clearPath) > radius + coinRadius(clearPath[0].materialId) + PLACEMENT_GAP)
      && obstacles.every((obstacle) => obstacleDistance(obstacle, point.x, point.z) > radius + PLACEMENT_GAP);
    const position = place(() => {
      const point = polar(openingSource ? OPENING_TARGET_MIN_DISTANCE + unit(random) * (OPENING_TARGET_MAX_DISTANCE - OPENING_TARGET_MIN_DISTANCE)
        : isEdge ? 0.68 + unit(random) * 0.05 : Math.sqrt(unit(random)) * maxRadius, unit(random) * Math.PI * 2);
      return openingSource ? { x: point.x + openingSource.x, z: point.z + openingSource.z } : point;
    }, accepts, isEdge ? [0.70, 0.68, 0.73] : fallbackRadii);
    coins.push({ id: id('coin'), ...position, materialId });
  }
  return coins;
}

/** Round counts are additions: a carried survivor is extra. Coordinates and dimensions use metres. */
export function generateRound(round: number, retained: CoinTransform[] = [], random: () => number = Math.random): LevelConfig {
  if (!Number.isSafeInteger(round) || round < 1) throw new Error('轮次必须是正整数');
  if (retained.length > 1 || (round === 1 && retained.length)) throw new Error('新轮次只能保留上一轮唯一存活硬币');
  const prefix = `campaign-${++generation}-round-${round}`;
  const table: TableConfig = { shape: 'circle', width: 1.6, depth: 1.6,
    materialId: round < 5 ? 'wood' : round < 7 ? 'marble' : unit(random) < 0.5 ? 'wood' : 'marble' };
  const carry = retainedCoins(retained, table);
  const id = idFactory(carry.map((coin) => coin.id), prefix);
  const count = round === 1 ? 4 : round < 4 ? 6 : round < 7 ? 7 : integer(5, 9, random);
  const glassCount = round === 3 ? 2 : round === 6 ? 3 : round >= 7 ? integer(3, 6, random) : 0;
  const materials: CoinMaterialId[] = Array.from({ length: count }, (_, index) => round < 4 ? 'standard'
    : round <= 5 ? index < 2 ? 'iron' : 'standard' : unit(random) < 0.5 ? 'standard' : 'iron');
  // Shuffle the two mandatory iron coins so their generation order does not bias their placement.
  if (round === 4 || round === 5) for (let index = materials.length - 1; index > 0; index--) {
    const other = integer(0, index, random);
    [materials[index], materials[other]] = [materials[other], materials[index]];
  }
  // Preserve a first geometric target before cups arrive, so the carried coin cannot be enclosed.
  // This is a clear straight corridor, not a production-physics proof of a complete random round.
  const opening = carry.length ? addCoins(table, carry, [], [materials[0]], random, id, 0, undefined, carry[0]) : carry;
  const clearPath: [CoinConfig, CoinConfig] | undefined = carry.length ? [opening[0], opening[1]] : undefined;
  const obstacles: ObstacleConfig[] = [];
  for (let index = 0; index < glassCount; index++) {
    const position = place(() => polar(Math.sqrt(unit(random)) * GLASS_CENTRE_RADIUS, unit(random) * Math.PI * 2),
      (point) => carry.every((coin) => distance(point, coin) > GLASS_DIAMETER / 2 + coinRadius(coin.materialId) + PLACEMENT_GAP)
        && (!clearPath || pathDistance(point, clearPath) > GLASS_DIAMETER / 2 + coinRadius(clearPath[0].materialId) + PLACEMENT_GAP)
        && obstacles.every((glass) => distance(point, glass) > GLASS_DIAMETER + PLACEMENT_GAP),
      [0, 0.12, 0.24, 0.36, GLASS_CENTRE_RADIUS]);
    obstacles.push({ id: id('glass'), kind: 'glass', ...position, width: GLASS_DIAMETER, depth: GLASS_DIAMETER });
  }
  const coins = addCoins(table, opening, obstacles, carry.length ? materials.slice(1) : materials,
    random, id, round === 2 ? 1 : 0, clearPath);
  return { schemaVersion: 1, id: prefix, name: `第 ${round} 轮`, lesson: '从存活硬币继续，逐枚接力清空桌面',
    table, coins, activeCoinId: carry[0]?.id ?? coins[0].id, obstacles };
}

/** Revival preserves the settled board and replaces precisely the fallen count with gold coins. */
export function generateRevival(level: LevelConfig, retained: CoinTransform[], fallenCount: number,
  random: () => number = Math.random): LevelConfig {
  if (!Number.isSafeInteger(fallenCount) || fallenCount < 0) throw new Error('补币数量必须是非负整数');
  if (retained.length + fallenCount > PHYSICS_CONFIG.maxCoins) throw new Error('关卡硬币数量超过支持上限');
  const table = { ...level.table };
  const carry = retainedCoins(retained, table);
  if (carry.length + fallenCount < 2) throw new Error('复活后至少需要两枚硬币');
  const obstacles = level.obstacles.map((obstacle) => ({ ...obstacle }));
  const prefix = `campaign-${++generation}-revival`;
  const id = idFactory([...level.coins.map((coin) => coin.id), ...carry.map((coin) => coin.id), ...obstacles.map((obstacle) => obstacle.id)], prefix);
  const coins = addCoins(table, carry, obstacles, Array.from({ length: fallenCount }, () => 'standard'), random, id);
  return { ...level, id: prefix, table, obstacles, coins, activeCoinId: coins[0].id };
}
