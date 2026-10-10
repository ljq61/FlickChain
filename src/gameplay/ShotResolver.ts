import type { FoulReason, ShotFacts, ShotResult } from '../types/contracts';

/** Whole-shot evaluation. Environment contacts never enter this input. */
export function resolveShot(facts: ShotFacts): ShotResult {
  const targets = new Set<string>();
  for (const [a, b] of facts.contacts) {
    // Only direct contacts from the fired source determine the target set.
    // Downstream collisions (for example B→C after A→B) are legal chain motion.
    if (a === facts.sourceCoinId && b !== facts.sourceCoinId) targets.add(b);
    else if (b === facts.sourceCoinId && a !== facts.sourceCoinId) targets.add(a);
  }
  const reasons: FoulReason[] = [];
  if (targets.size === 0) reasons.push('MISS');
  if (targets.size > 1) reasons.push('MULTI_HIT');
  if (facts.fallenCoinIds.length > 0) reasons.push('FALL');
  if (facts.timedOut) reasons.push('TIMEOUT');
  if (reasons.length > 0) return { outcome: 'FOUL', sourceCoinId: facts.sourceCoinId, reasons };
  return { outcome: 'SUCCESS', sourceCoinId: facts.sourceCoinId, targetCoinId: [...targets][0], reasons: [] };
}

/** Only facts already certain mid-flight; a miss cannot be decided early. */
export function certainFouls(facts: ShotFacts): FoulReason[] {
  return resolveShot(facts).reasons.filter((reason) => reason !== 'MISS');
}
