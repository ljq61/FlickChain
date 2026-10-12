import type { LevelConfig, ObstacleConfig, TableConfig } from '../types/contracts';
import { COIN_RADIUS, PHYSICS_CONFIG, coinRadius } from '../physics/MaterialRegistry';
import { tableClearance } from '../physics/TableGeometry';

type RecordValue = Record<string, unknown>;
const fail = (path: string, message: string): never => { throw new Error(`Level ${path}: ${message}`); };
function record(value: unknown, path: string, keys: string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'Must be an object');
  const result = value as RecordValue;
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key}`, 'Unknown field');
  return result;
}
function finite(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'Must be a finite number');
  if (positive && value <= 0) fail(path, 'Must be greater than zero');
  return value as number;
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'Must be a nonempty string');
  return value as string;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'Must be an array');
  return value as unknown[];
}
function axes(box: ObstacleConfig): [number, number][] {
  const angle = box.rotation ?? 0;
  // Rapier/Three positive yaw: local +X rotates toward world -Z.
  return [[Math.cos(angle), -Math.sin(angle)], [Math.sin(angle), Math.cos(angle)]];
}
function extent(box: ObstacleConfig, axis: [number, number]): number {
  const [a, b] = axes(box);
  return Math.abs(a[0] * axis[0] + a[1] * axis[1]) * box.width / 2
    + Math.abs(b[0] * axis[0] + b[1] * axis[1]) * box.depth / 2;
}
export function obstacleDistance(box: ObstacleConfig, x: number, z: number): number {
  if (box.kind === 'glass') return Math.max(0, Math.hypot(x - box.x, z - box.z) - box.width / 2);
  const [a, b] = axes(box);
  const dx = x - box.x, dz = z - box.z;
  const localX = dx * a[0] + dz * a[1], localZ = dx * b[0] + dz * b[1];
  return Math.hypot(Math.max(Math.abs(localX) - box.width / 2, 0), Math.max(Math.abs(localZ) - box.depth / 2, 0));
}
function overlaps(a: ObstacleConfig, b: ObstacleConfig): boolean {
  if (a.kind === 'glass') return obstacleDistance(b, a.x, a.z) <= a.width / 2;
  if (b.kind === 'glass') return obstacleDistance(a, b.x, b.z) <= b.width / 2;
  return [...axes(a), ...axes(b)].every((axis) =>
    Math.abs((a.x - b.x) * axis[0] + (a.z - b.z) * axis[1]) <= extent(a, axis) + extent(b, axis));
}

/** Retained allowances are for reconfiguration only; initial create always uses strict clearance. */
export function validateLevel(input: unknown, retainedIds: ReadonlySet<string> = new Set(), retainedObstacleIds: ReadonlySet<string> = new Set()): LevelConfig {
  const raw = record(input, 'root', ['schemaVersion', 'purpose', 'id', 'name', 'lesson', 'table', 'coins', 'activeCoinId', 'obstacles']);
  if (raw.schemaVersion !== 1) fail('schemaVersion', 'Only schema version 1 is supported');
  if (raw.purpose !== undefined && raw.purpose !== 'opening') fail('purpose', 'Unknown level purpose');
  const opening = raw.purpose === 'opening';
  const table = record(raw.table, 'table', ['width', 'depth', 'materialId', 'shape']);
  if (table.materialId !== 'wood' && table.materialId !== 'marble') fail('table.materialId', 'Unknown table material');
  const width = finite(table.width, 'table.width', true);
  const depth = finite(table.depth, 'table.depth', true);
  if (table.shape !== undefined && table.shape !== 'rectangle' && table.shape !== 'circle') fail('table.shape', 'Unknown table shape');
  if (table.shape === 'circle' && width !== depth) fail('table', 'Circular table width and depth must have the same diameter');
  const tableConfig: TableConfig = { width, depth, materialId: table.materialId as TableConfig['materialId'] };
  if (table.shape !== undefined) tableConfig.shape = table.shape as TableConfig['shape'];
  if (width <= COIN_RADIUS * 4 || depth <= COIN_RADIUS * 4) fail('table', 'Table dimensions are too small to support coins');
  const ids = new Set<string>();
  const unique = (value: unknown, path: string): string => {
    const id = string(value, path);
    if (ids.has(id)) fail(path, `Duplicate ID ${id}`);
    ids.add(id);
    return id;
  };
  const coins = array(raw.coins, 'coins').map((value, i) => {
    const path = `coins[${i}]`;
    const coin = record(value, path, ['id', 'x', 'z', 'materialId']);
    if (coin.materialId !== 'standard' && coin.materialId !== 'iron') fail(`${path}.materialId`, 'Unknown coin material');
    const x = finite(coin.x, `${path}.x`);
    const z = finite(coin.z, `${path}.z`);
    const id = unique(coin.id, `${path}.id`);
    const materialId = coin.materialId as 'standard' | 'iron';
    if (tableClearance(tableConfig, x, z) <= (retainedIds.has(id) ? 0 : coinRadius(materialId) + PHYSICS_CONFIG.initialClearance)) fail(path, 'Coin is out of bounds or too close to the table edge');
    return { id, x, z, materialId };
  });
  if (opening) {
    if (coins.length !== 1 || coins[0].materialId !== 'standard') fail('coins', 'Opening Flick requires exactly one gold coin');
  } else if (coins.length < 2) fail('coins', 'CLEAR_ALL requires at least two coins');
  if (coins.length > PHYSICS_CONFIG.maxCoins) fail('coins', `At most ${PHYSICS_CONFIG.maxCoins} coins are supported`);
  const activeCoinId = string(raw.activeCoinId, 'activeCoinId');
  if (!coins.some((coin) => coin.id === activeCoinId)) fail('activeCoinId', 'Must reference an existing coin');
  const obstacles: ObstacleConfig[] = array(raw.obstacles, 'obstacles').map((value, i) => {
    const path = `obstacles[${i}]`;
    const box = record(value, path, ['id', 'x', 'z', 'width', 'depth', 'rotation', 'kind']);
    const result: ObstacleConfig = {
      id: unique(box.id, `${path}.id`), x: finite(box.x, `${path}.x`), z: finite(box.z, `${path}.z`),
      width: finite(box.width, `${path}.width`, true), depth: finite(box.depth, `${path}.depth`, true),
    };
    if (box.kind !== undefined) {
      if (box.kind !== 'box' && box.kind !== 'glass') fail(`${path}.kind`, 'Unknown obstacle kind');
      result.kind = box.kind as ObstacleConfig['kind'];
    }
    if (result.kind === 'glass' && result.width !== result.depth) fail(path, 'Glass cup width and depth must have the same diameter');
    if (box.rotation !== undefined) result.rotation = finite(box.rotation, `${path}.rotation`);
    const [a, b] = axes(result);
    if (result.kind === 'glass') {
      if (tableClearance(tableConfig, result.x, result.z) <= result.width / 2) fail(path, 'Obstacle is out of bounds or too close to the table edge');
    } else for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
      const x = result.x + sideX * a[0] * result.width / 2 + sideZ * b[0] * result.depth / 2;
      const z = result.z + sideX * a[1] * result.width / 2 + sideZ * b[1] * result.depth / 2;
      if (tableClearance(tableConfig, x, z) <= 0) fail(path, 'Obstacle is out of bounds or too close to the table edge');
    }
    return result;
  });
  if (opening && obstacles.length !== 0) fail('obstacles', 'Opening Flick cannot have obstacles');
  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    for (const other of coins.slice(i + 1)) {
      if (!(retainedIds.has(coin.id) && retainedIds.has(other.id)) && Math.hypot(coin.x - other.x, coin.z - other.z) <= coinRadius(coin.materialId) + coinRadius(other.materialId) + PHYSICS_CONFIG.initialClearance) fail('coins', `${coin.id} and ${other.id} overlap or touch`);
    }
    for (const box of obstacles) {
      if (retainedIds.has(coin.id) && retainedObstacleIds.has(box.id)) continue;
      const distance = obstacleDistance(box, coin.x, coin.z);
      if (distance <= coinRadius(coin.materialId) + PHYSICS_CONFIG.initialClearance) fail('obstacles', `${coin.id} and ${box.id} overlap or touch`);
    }
  }
  for (let i = 0; i < obstacles.length; i++) {
    for (const other of obstacles.slice(i + 1)) {
      if (overlaps(obstacles[i], other)) fail('obstacles', `${obstacles[i].id} and ${other.id} overlap or touch`);
    }
  }
  return { schemaVersion: 1, ...(opening ? { purpose: 'opening' as const } : {}), id: string(raw.id, 'id'), name: string(raw.name, 'name'), lesson: string(raw.lesson, 'lesson'),
    table: tableConfig, coins, activeCoinId, obstacles };
}
