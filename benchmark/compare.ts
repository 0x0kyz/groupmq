#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';

const program = new Command();
program
  .option('--before <file>', 'Before benchmark results JSON file', '')
  .option('--after <file>', 'After benchmark results JSON file', '')
  .parse();

interface BenchmarkResult {
  timestamp: number;
  queueType: string;
  jobType: string;
  totalJobs: number;
  workersCount: number;
  completedJobs: number;
  durationMs: number;
  throughputJobsPerSec: number;
  avgPickupMs: number;
  avgProcessingMs: number;
  avgTotalMs: number;
  p95PickupMs: number;
  p95ProcessingMs: number;
  p95TotalMs: number;
  peakCpuPercent: number;
  peakMemoryMB: number;
  avgCpuPercent: number;
  avgMemoryMB: number;
  redisStats?: {
    summary: {
      totalCalls: number;
      avgUsecPerCall: number;
      topCommands: Array<{ command?: string; calls: number; usec_per_call: number }>;
    };
    info: {
      used_memory: number;
      total_commands_processed: number;
      instantaneous_ops_per_sec: number;
    };
  };
}

function loadResults(filePath: string): BenchmarkResult | null {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    // Handle both single result and array of results
    const results = Array.isArray(parsed) ? parsed : [parsed];
    // Return the most recent result
    return results.sort((a, b) => b.timestamp - a.timestamp)[0];
  } catch (err) {
    console.error(`Error loading ${filePath}:`, err);
    return null;
  }
}

function formatNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals);
}

function formatPercentChange(before: number, after: number): string {
  const change = ((after - before) / before) * 100;
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

function compareResults(before: BenchmarkResult, after: BenchmarkResult): void {
  console.log('\n' + '='.repeat(80));
  console.log('📊 BENCHMARK COMPARISON');
  console.log('='.repeat(80));

  console.log('\n🎯 THROUGHPUT:');
  console.log(
    `  Before: ${formatNumber(before.throughputJobsPerSec)} jobs/sec`,
  );
  console.log(`  After:  ${formatNumber(after.throughputJobsPerSec)} jobs/sec`);
  console.log(
    `  Change: ${formatPercentChange(before.throughputJobsPerSec, after.throughputJobsPerSec)}`,
  );

  console.log('\n⚡ LATENCY (ms):');
  console.log(
    `  Pickup (avg)    - Before: ${formatNumber(before.avgPickupMs)}  After: ${formatNumber(after.avgPickupMs)}  Change: ${formatPercentChange(before.avgPickupMs, after.avgPickupMs)}`,
  );
  console.log(
    `  Pickup (p95)    - Before: ${formatNumber(before.p95PickupMs)}  After: ${formatNumber(after.p95PickupMs)}  Change: ${formatPercentChange(before.p95PickupMs, after.p95PickupMs)}`,
  );
  console.log(
    `  Processing (avg)- Before: ${formatNumber(before.avgProcessingMs)}  After: ${formatNumber(after.avgProcessingMs)}  Change: ${formatPercentChange(before.avgProcessingMs, after.avgProcessingMs)}`,
  );
  console.log(
    `  Total (avg)     - Before: ${formatNumber(before.avgTotalMs)}  After: ${formatNumber(after.avgTotalMs)}  Change: ${formatPercentChange(before.avgTotalMs, after.avgTotalMs)}`,
  );

  if (before.redisStats && after.redisStats) {
    console.log('\n🔴 REDIS STATS:');
    console.log(
      `  Total Commands  - Before: ${before.redisStats.summary.totalCalls.toLocaleString()}  After: ${after.redisStats.summary.totalCalls.toLocaleString()}  Change: ${formatPercentChange(before.redisStats.summary.totalCalls, after.redisStats.summary.totalCalls)}`,
    );

    const beforeCommandsPerJob =
      before.completedJobs > 0
        ? before.redisStats.summary.totalCalls / before.completedJobs
        : 0;
    const afterCommandsPerJob =
      after.completedJobs > 0
        ? after.redisStats.summary.totalCalls / after.completedJobs
        : 0;

    console.log(
      `  Commands/Job    - Before: ${formatNumber(beforeCommandsPerJob)}  After: ${formatNumber(afterCommandsPerJob)}  Change: ${formatPercentChange(beforeCommandsPerJob, afterCommandsPerJob)}`,
    );

    console.log(
      `  Avg μs/call     - Before: ${formatNumber(before.redisStats.summary.avgUsecPerCall)}  After: ${formatNumber(after.redisStats.summary.avgUsecPerCall)}  Change: ${formatPercentChange(before.redisStats.summary.avgUsecPerCall, after.redisStats.summary.avgUsecPerCall)}`,
    );

    console.log(
      `  Ops/sec         - Before: ${before.redisStats.info.instantaneous_ops_per_sec.toLocaleString()}  After: ${after.redisStats.info.instantaneous_ops_per_sec.toLocaleString()}  Change: ${formatPercentChange(before.redisStats.info.instantaneous_ops_per_sec, after.redisStats.info.instantaneous_ops_per_sec)}`,
    );

    console.log('\n  Top Commands Comparison:');
    const beforeTop = before.redisStats.summary.topCommands.slice(0, 5);
    const afterTop = after.redisStats.summary.topCommands.slice(0, 5);
    const allCommands = new Set([
      ...beforeTop.map((c) => c.command || ''),
      ...afterTop.map((c) => c.command || ''),
    ]);

    for (const cmd of allCommands) {
      const beforeCmd = beforeTop.find((c) => c.command === cmd);
      const afterCmd = afterTop.find((c) => c.command === cmd);
      if (beforeCmd && afterCmd) {
        console.log(
          `    ${(cmd || 'unknown').padEnd(15)} - Before: ${beforeCmd.calls.toString().padStart(6)} calls  After: ${afterCmd.calls.toString().padStart(6)} calls  Change: ${formatPercentChange(beforeCmd.calls, afterCmd.calls)}`,
        );
      } else if (beforeCmd) {
        console.log(
          `    ${(cmd || 'unknown').padEnd(15)} - Before: ${beforeCmd.calls.toString().padStart(6)} calls  After: removed`,
        );
      } else if (afterCmd) {
        console.log(
          `    ${(cmd || 'unknown').padEnd(15)} - Before: removed  After: ${afterCmd.calls.toString().padStart(6)} calls`,
        );
      }
    }
  }

  console.log('\n💻 SYSTEM USAGE:');
  console.log(
    `  CPU (avg)       - Before: ${formatNumber(before.avgCpuPercent)}%  After: ${formatNumber(after.avgCpuPercent)}%  Change: ${formatPercentChange(before.avgCpuPercent, after.avgCpuPercent)}`,
  );
  console.log(
    `  Memory (peak)   - Before: ${formatNumber(before.peakMemoryMB)}MB  After: ${formatNumber(after.peakMemoryMB)}MB  Change: ${formatPercentChange(before.peakMemoryMB, after.peakMemoryMB)}`,
  );

  console.log('\n' + '='.repeat(80));
}

// Main
const opts = program.opts();

if (!opts.before && !opts.after) {
  // Try to find latest results in benchmark/results/
  const resultsDir = path.join(process.cwd(), 'benchmark', 'results');
  if (fs.existsSync(resultsDir)) {
    const files = fs.readdirSync(resultsDir);
    const groupmqFiles = files
      .filter((f) => f.startsWith('groupmq') && f.endsWith('.json'))
      .sort()
      .reverse();
    if (groupmqFiles.length >= 2) {
      opts.before = path.join(resultsDir, groupmqFiles[1]);
      opts.after = path.join(resultsDir, groupmqFiles[0]);
      console.log(`Using before: ${groupmqFiles[1]}`);
      console.log(`Using after: ${groupmqFiles[0]}`);
    }
  }
}

const before = opts.before ? loadResults(opts.before) : null;
const after = opts.after ? loadResults(opts.after) : null;

if (!before || !after) {
  console.error('Error: Need both --before and --after results files');
  console.error('Usage: npx jiti benchmark/compare.ts --before <file> --after <file>');
  process.exit(1);
}

compareResults(before, after);
