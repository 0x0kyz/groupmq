import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from '../src';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('Lua script cache recovery', () => {
  const namespace = `test:script-cache:${Date.now()}`;

  afterAll(async () => {
    const redis = new Redis(REDIS_URL);
    const keys = await redis.keys(`${namespace}*`);
    if (keys.length) await redis.del(keys);
    await redis.quit();
  });

  it('recovers from SCRIPT FLUSH on the server', async () => {
    const redis = new Redis(REDIS_URL);
    const flusher = new Redis(REDIS_URL);
    const q = new Queue({ redis, namespace: `${namespace}:flush` });

    const processed: number[] = [];
    const errors: string[] = [];

    const worker = new Worker({
      queue: q,
      blockingTimeoutSec: 1,
      handler: async (job) => {
        processed.push(job.data.id);
      },
      onError: (err) => {
        errors.push((err as Error).message);
      },
    });

    worker.run();

    await q.add({ groupId: 'g', data: { id: 1 } });

    const deadline = Date.now() + 5000;
    while (processed.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(processed).toContain(1);

    // Wipe scripts on the server while the cached SHAs on the client survive.
    await flusher.script('FLUSH');

    await q.add({ groupId: 'g', data: { id: 2 } });

    const deadline2 = Date.now() + 5000;
    while (processed.length < 2 && Date.now() < deadline2) {
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(processed).toContain(2);
    expect(errors.filter((e) => e.includes('NOSCRIPT'))).toHaveLength(0);

    await worker.close();
    await redis.quit();
    await flusher.quit();
  }, 15_000);
});
