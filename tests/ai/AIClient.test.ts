import { afterEach, describe, expect, it, vi } from 'vitest';
import { AIClient, type AIRequest, type AIResponse } from '../../src/ai/AIClient';
import { generateOpening } from '../../src/content/BattleGenerator';
class FakeWorker {
  onmessage: ((event: MessageEvent<AIResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  requests: AIRequest[] = [];
  postMessage(request: AIRequest): void { this.requests.push(request); }
  respond(response: AIResponse): void { this.onmessage?.({ data: response } as MessageEvent<AIResponse>); }
}
const level = () => generateOpening({ shape: 'circle', width: 1.6, depth: 1.6, materialId: 'wood' });
afterEach(() => vi.useRealTimers());
describe('worker decision ownership', () => {
  it('cancels a previous job, rejects its promise and ignores its late decision across a restart', async () => {
    const workers: FakeWorker[] = [];
    const client = new AIClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; });
    const old = client.chooseOpening(level());
    const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const fresh = client.chooseOpening(level());
    await cancelled;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[0].respond({ id: workers[0].requests[0].id, kind: 'opening', power: 0.9 });
    workers[1].respond({ id: workers[1].requests[0].id + 1, kind: 'opening', power: 0.8 });
    workers[1].respond({ id: workers[1].requests[0].id, kind: 'opening', power: 0.6 });
    expect(await fresh).toBe(0.6); client.dispose();
  });
  it('propagates worker failure and terminates a worker that exceeds the delivery timeout', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker(), client = new AIClient(() => worker as unknown as Worker);
    const failed = client.chooseOpening(level());
    const timeout = expect(failed).rejects.toThrow(/超时/);
    await vi.advanceTimersByTimeAsync(10001); await timeout;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const next = client.chooseOpening(level());
    const error = expect(next).rejects.toThrow('WASM 失败');
    worker.respond({ id: worker.requests[1].id, error: 'WASM 失败' }); await error;
    client.dispose();
    await expect(client.chooseOpening(level())).rejects.toThrow(/销毁/);
  });
  it('rejects malformed decisions rather than letting invalid power reach live physics', async () => {
    const worker = new FakeWorker(), client = new AIClient(() => worker as unknown as Worker);
    const decision = client.chooseOpening(level());
    const invalid = expect(decision).rejects.toThrow(/无效决定/);
    worker.respond({ id: worker.requests[0].id, kind: 'opening', power: NaN }); await invalid;
    expect(worker.terminate).toHaveBeenCalledOnce(); client.dispose();
  });
});
