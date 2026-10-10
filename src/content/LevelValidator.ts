import type { LevelConfig, ObstacleConfig } from '../types/contracts';
import { COIN_RADIUS, PHYSICS_CONFIG } from '../physics/MaterialRegistry';

type RecordValue = Record<string, unknown>;
const fail = (path: string, message: string): never => { throw new Error(`关卡 ${path}: ${message}`); };
function record(value: unknown, path: string, keys: string[]): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, '必须是对象');
  const result = value as RecordValue;
  for (const key of Object.keys(result)) if (!keys.includes(key)) fail(`${path}.${key}`, '未知字段');
  return result;
}
function finite(value: unknown, path: string, positive = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, '必须是有限数字');
  if (positive && value <= 0) fail(path, '必须大于零');
  return value as number;
}
function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(path, '必须是非空字符串');
  return value as string;
}
function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, '必须是数组');
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
function overlaps(a: ObstacleConfig, b: ObstacleConfig): boolean {
  return [...axes(a), ...axes(b)].every((axis) =>
    Math.abs((a.x - b.x) * axis[0] + (a.z - b.z) * axis[1]) <= extent(a, axis) + extent(b, axis));
}

/** Production and tests share the same SI-metre, wood/standard CLEAR_ALL schema. */
export function validateLevel(input: unknown): LevelConfig {
  const raw = record(input, 'root', ['schemaVersion', 'id', 'name', 'lesson', 'table', 'coins', 'activeCoinId', 'obstacles']);
  if (raw.schemaVersion !== 1) fail('schemaVersion', '仅支持版本 1');
  const table = record(raw.table, 'table', ['width', 'depth', 'materialId']);
  if (table.materialId !== 'wood') fail('table.materialId', '未知桌面材质');
  const width = finite(table.width, 'table.width', true);
  const depth = finite(table.depth, 'table.depth', true);
  if (width <= COIN_RADIUS * 4 || depth <= COIN_RADIUS * 4) fail('table', '尺寸不足以支撑硬币');
  const ids = new Set<string>();
  const unique = (value: unknown, path: string): string => {
    const id = string(value, path);
    if (ids.has(id)) fail(path, `重复 ID ${id}`);
    ids.add(id);
    return id;
  };
  const coins = array(raw.coins, 'coins').map((value, i) => {
    const path = `coins[${i}]`;
    const coin = record(value, path, ['id', 'x', 'z', 'materialId']);
    if (coin.materialId !== 'standard') fail(`${path}.materialId`, '未知硬币材质');
    const x = finite(coin.x, `${path}.x`);
    const z = finite(coin.z, `${path}.z`);
    if (Math.abs(x) + COIN_RADIUS + PHYSICS_CONFIG.initialClearance >= width / 2
      || Math.abs(z) + COIN_RADIUS + PHYSICS_CONFIG.initialClearance >= depth / 2) fail(path, '硬币越界或贴边');
    return { id: unique(coin.id, `${path}.id`), x, z, materialId: 'standard' as const };
  });
  if (coins.length < 2) fail('coins', 'CLEAR_ALL 至少需要两枚硬币');
  if (coins.length > PHYSICS_CONFIG.maxCoins) fail('coins', `最多支持 ${PHYSICS_CONFIG.maxCoins} 枚硬币`);
  const activeCoinId = string(raw.activeCoinId, 'activeCoinId');
  if (!coins.some((coin) => coin.id === activeCoinId)) fail('activeCoinId', '必须引用存在的硬币');
  const obstacles: ObstacleConfig[] = array(raw.obstacles, 'obstacles').map((value, i) => {
    const path = `obstacles[${i}]`;
    const box = record(value, path, ['id', 'x', 'z', 'width', 'depth', 'rotation']);
    const result: ObstacleConfig = {
      id: unique(box.id, `${path}.id`), x: finite(box.x, `${path}.x`), z: finite(box.z, `${path}.z`),
      width: finite(box.width, `${path}.width`, true), depth: finite(box.depth, `${path}.depth`, true),
    };
    if (box.rotation !== undefined) result.rotation = finite(box.rotation, `${path}.rotation`);
    if (Math.abs(result.x) + extent(result, [1, 0]) >= width / 2
      || Math.abs(result.z) + extent(result, [0, 1]) >= depth / 2) fail(path, '障碍越界或贴边');
    return result;
  });
  for (let i = 0; i < coins.length; i++) {
    const coin = coins[i];
    for (const other of coins.slice(i + 1)) {
      if (Math.hypot(coin.x - other.x, coin.z - other.z) <= COIN_RADIUS * 2 + PHYSICS_CONFIG.initialClearance) fail('coins', `${coin.id} 与 ${other.id} 重叠或接触`);
    }
    for (const box of obstacles) {
      const [a, b] = axes(box);
      const dx = coin.x - box.x, dz = coin.z - box.z;
      const localX = dx * a[0] + dz * a[1], localZ = dx * b[0] + dz * b[1];
      const distance = Math.hypot(Math.max(Math.abs(localX) - box.width / 2, 0), Math.max(Math.abs(localZ) - box.depth / 2, 0));
      if (distance <= COIN_RADIUS + PHYSICS_CONFIG.initialClearance) fail('obstacles', `${coin.id} 与 ${box.id} 重叠或接触`);
    }
  }
  for (let i = 0; i < obstacles.length; i++) {
    for (const other of obstacles.slice(i + 1)) {
      if (overlaps(obstacles[i], other)) fail('obstacles', `${obstacles[i].id} 与 ${other.id} 重叠或接触`);
    }
  }
  return { schemaVersion: 1, id: string(raw.id, 'id'), name: string(raw.name, 'name'), lesson: string(raw.lesson, 'lesson'),
    table: { width, depth, materialId: 'wood' }, coins, activeCoinId, obstacles };
}
