import { describe, expect, it } from 'vitest';
import { tableClearance, tableContainsPoint } from '../../src/physics/TableGeometry';
import type { TableConfig } from '../../src/types/contracts';

describe('shared tabletop geometry', () => {
  const circle: TableConfig = { shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' };
  const rectangle: TableConfig = { width: 1.2, depth: 1.6, materialId: 'wood' };
  it('uses radial clearance, including points outside the circle but inside its bounding square', () => {
    expect(tableClearance(circle, 0, 0)).toBe(0.8);
    expect(tableClearance(circle, 0.48, 0.64)).toBeCloseTo(0);
    expect(tableContainsPoint(circle, 0.6, 0.6)).toBe(false);
    expect(tableContainsPoint({ ...circle, shape: 'rectangle' }, 0.6, 0.6)).toBe(true);
    expect(tableContainsPoint(circle, 0.8, 0)).toBe(true);
    expect(tableContainsPoint(circle, 0.7, 0, 0.09)).toBe(true);
    expect(tableContainsPoint(circle, 0.7, 0, 0.11)).toBe(false);
  });
  it('preserves legacy rectangle geometry and inclusive margin boundaries', () => {
    expect(tableClearance(rectangle, 0.3, 0.2)).toBeCloseTo(0.3);
    expect(tableContainsPoint(rectangle, -0.6, 0.8)).toBe(true);
    expect(tableContainsPoint(rectangle, 0.601, 0)).toBe(false);
    expect(tableContainsPoint(rectangle, 0.5, 0, 0.09)).toBe(true);
    expect(tableContainsPoint(rectangle, 0.5, 0, 0.11)).toBe(false);
  });
});
