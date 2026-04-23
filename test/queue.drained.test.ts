import Redis from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { Queue, Worker } from '../src';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

describe("Worker 'drained' event", () => {
  const namespace = `test:drained:${Date.now()}`;

  afterAll(async () => {
    const redis = new Redis(REDIS_URL);
    const keys = await redis.keys(`${namespace}*`);
    if (keys.length) await redis.del(keys);
    await redis.quit();
  });

  it('fires on an empty queue after the worker starts polling', async () => {
    const redis = new Redis(REDIS_URL);
    const q = new Queue({ redis, namespace: `${namespace}:empty` });

    let drainedCount = 0;
    const worker = new Worker({
      queue: q,
      blockingTimeoutSec: 1,
      concurrency: 1,
      handler: async () => {},
    });
    worker.on('drained', () => {
      drainedCount++;
    });
    worker.run();

    await new Promise((resolve) => setTimeout(resolve, 3000));
    await worker.close();
    await redis.quit();

    expect(drainedCount).toBeGreaterThan(0);
  }, 10_000);

  it('fires after processing all jobs', async () => {
    const redis = new Redis(REDIS_URL);
    const q = new Queue({ redis, namespace: `${namespace}:after-work` });

    await q.add({ groupId: 'g1', data: { n: 1 } });
    await q.add({ groupId: 'g1', data: { n: 2 } });

    let completedCount = 0;
    let drainedAfterAllCompleted = false;
    const worker = new Worker({
      queue: q,
      blockingTimeoutSec: 1,
      concurrency: 1,
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    worker.on('completed', () => {
      completedCount++;
    });
    worker.on('drained', () => {
      if (completedCount === 2) drainedAfterAllCompleted = true;
    });
    worker.run();

    await q.waitForEmpty();
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await worker.close();
    await redis.quit();

    expect(completedCount).toBe(2);
    expect(drainedAfterAllCompleted).toBe(true);
  }, 15_000);

  it('does not fire while jobs are actively processing', async () => {
    const redis = new Redis(REDIS_URL);
    const q = new Queue({ redis, namespace: `${namespace}:busy` });

    for (let i = 0; i < 5; i++) {
      await q.add({ groupId: `g${i}`, data: { i } });
    }

    let drainedDuringWork = 0;
    let jobsRunning = 0;
    const worker = new Worker({
      queue: q,
      blockingTimeoutSec: 1,
      concurrency: 5,
      handler: async () => {
        jobsRunning++;
        await new Promise((resolve) => setTimeout(resolve, 500));
        jobsRunning--;
      },
    });
    worker.on('drained', () => {
      if (jobsRunning > 0) drainedDuringWork++;
    });
    worker.run();

    await q.waitForEmpty();
    await worker.close();
    await redis.quit();

    expect(drainedDuringWork).toBe(0);
  }, 15_000);
});
