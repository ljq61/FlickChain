import { searchBattle, searchOpening } from './BattleSearch';
import type { AIRequest, AIResponse } from './AIClient';

// Kept separate from the DOM client so only this worker imports production Rapier.
const worker = globalThis as unknown as { onmessage: (event: MessageEvent<AIRequest>) => void; postMessage: (response: AIResponse) => void };
worker.onmessage = async ({ data }) => {
  try {
    if (data.kind === 'opening') worker.postMessage({ id: data.id, kind: 'opening', power: await searchOpening(data.level) });
    else worker.postMessage({ id: data.id, kind: 'battle', shot: (await searchBattle(data.snapshot)).shot });
  } catch (error) { worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }); }
};
