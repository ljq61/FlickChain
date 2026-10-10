import type { TableConfig } from '../types/contracts';

/** Signed distance to the tabletop boundary in the XZ plane; positive is inside. */
export function tableClearance(table: TableConfig, x: number, z: number): number {
  return table.shape === 'circle'
    ? table.width / 2 - Math.hypot(x, z)
    : Math.min(table.width / 2 - Math.abs(x), table.depth / 2 - Math.abs(z));
}

/** Margin is the required inward clearance, in metres. Legacy tables are rectangular. */
export function tableContainsPoint(table: TableConfig, x: number, z: number, margin = 0): boolean {
  return tableClearance(table, x, z) >= margin;
}
