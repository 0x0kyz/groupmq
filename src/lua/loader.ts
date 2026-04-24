import type Redis from 'ioredis';
import { LUA_SCRIPTS } from './scripts.generated';

export type ScriptName =
  | 'enqueue'
  | 'enqueue-batch'
  | 'enqueue-simple'
  | 'reserve'
  | 'reserve-batch'
  | 'reserve-atomic'
  | 'reserve-simple'
  | 'complete'
  | 'complete-and-reserve-next-with-metadata'
  | 'complete-with-metadata'
  | 'retry'
  | 'heartbeat'
  | 'cleanup'
  | 'promote-staged'
  | 'get-active-count'
  | 'get-waiting-count'
  | 'get-active-jobs'
  | 'get-waiting-jobs'
  | 'get-unique-groups'
  | 'get-unique-groups-count'
  | 'cleanup-poisoned-group'
  | 'remove'
  | 'clean-status'
  | 'is-empty'
  | 'dead-letter'
  | 'record-job-result'
  | 'check-stalled';

const cacheByClient = new WeakMap<Redis, Map<ScriptName, string>>();

export async function loadScript(
  client: Redis,
  name: ScriptName,
): Promise<string> {
  let map = cacheByClient.get(client);
  if (!map) {
    map = new Map();
    cacheByClient.set(client, map);
  }
  const cached = map.get(name);
  if (cached) return cached;

  const lua = LUA_SCRIPTS[name];
  if (!lua) {
    throw new Error(`Unknown Lua script: ${name}`);
  }
  const sha = await (client as any).script('load', lua);
  map.set(name, sha as string);
  return sha as string;
}

export async function evalScript<T = any>(
  client: Redis,
  name: ScriptName,
  argv: Array<string>,
  numKeys: number,
): Promise<T> {
  const sha = await loadScript(client, name);
  try {
    return await (client as any).evalsha(sha, numKeys, ...argv);
  } catch (err) {
    const message = (err as { message?: string } | null)?.message ?? '';
    if (message.includes('NOSCRIPT')) {
      cacheByClient.get(client)?.delete(name);
      const freshSha = await loadScript(client, name);
      return (client as any).evalsha(freshSha, numKeys, ...argv);
    }
    throw err;
  }
}
