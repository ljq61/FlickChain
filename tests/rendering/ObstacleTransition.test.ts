import { describe, expect, it } from 'vitest';
import { ObstacleTransition } from '../../src/rendering/ObstacleTransition';

describe('continuous round glass animation', () => {
  it('only drops new glasses and restores zero offsets, leaving a survivor untouched', () => {
    const transition = new ObstacleTransition();
    transition.beginArrival(['new-a', 'new-b']);
    expect(transition.arriving).toBe(true);
    expect(transition.pose('old')).toEqual({ height: 0, x: 0, tilt: 0, visible: true });
    transition.advanceArrival(0.1);
    expect(transition.pose('new-a').height).toBeLessThan(transition.pose('new-b').height);
    for (let i = 0; i < 60; i++) transition.advanceArrival(1 / 60);
    expect(transition.arriving).toBe(false);
    expect(transition.pose('new-a')).toEqual({ height: 0, x: 0, tilt: 0, visible: true });
    transition.beginArrival([]);
    expect(transition.arriving).toBe(false);
  });

  it('lifts before carrying away, finishes every glass, and resets for the next round', () => {
    const transition = new ObstacleTransition();
    transition.beginRemoval(['a', 'b']);
    transition.advanceRemoval(0.1);
    expect(transition.pose('a').height).toBeGreaterThan(0);
    expect(transition.pose('a').x).toBe(0);
    for (let i = 0; i < 20; i++) transition.advanceRemoval(1 / 60);
    expect(transition.pose('a').x).toBeGreaterThan(0);
    expect(transition.pose('b').x).toBeLessThan(0);
    for (let i = 0; i < 40; i++) transition.advanceRemoval(1 / 60);
    expect(transition.removing).toBe(false);
    expect(transition.pose('a').visible).toBe(false);
    expect(transition.pose('b').visible).toBe(false);
    transition.reset();
    expect(transition.pose('a')).toEqual({ height: 0, x: 0, tilt: 0, visible: true });
  });

  it('provides a short empty-table handover and respects reduced motion and frame backlog', () => {
    const transition = new ObstacleTransition();
    transition.beginRemoval([]);
    transition.advanceRemoval(5);
    expect(transition.removing).toBe(true);
    transition.advanceRemoval(0.1);
    transition.advanceRemoval(0.1);
    expect(transition.removing).toBe(false);
    transition.reset();
    transition.beginArrival(['quiet'], true);
    expect(transition.arriving).toBe(false);
    transition.beginRemoval(['quiet'], true);
    expect(transition.removing).toBe(false);
    expect(transition.pose('quiet').visible).toBe(false);
  });
});
