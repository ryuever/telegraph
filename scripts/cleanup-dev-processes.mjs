#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const repoRoot = path.resolve(process.cwd());
const dryRun = process.argv.includes('--dry-run');
const waitMs = readNumberArg('--wait-ms', 1_500);

const processTable = readProcessTable();
const byParent = groupByParent(processTable);
const directTargets = processTable.filter(isDirectTarget);
const targetPids = new Set(directTargets.map((row) => row.pid));

for (const row of directTargets) {
  addDescendants(row.pid, byParent, targetPids);
}

const targets = processTable
  .filter((row) => targetPids.has(row.pid) && row.pid !== process.pid)
  .sort((left, right) => processDepth(right.pid, byParent) - processDepth(left.pid, byParent));

if (targets.length === 0) {
  console.log('No Telegraph dev/test processes found.');
  process.exit(0);
}

console.log(`${dryRun ? 'Would stop' : 'Stopping'} ${targets.length} Telegraph dev/test process(es):`);
for (const target of targets) {
  console.log(`- ${target.pid} ${target.command}`);
}

if (dryRun) {
  process.exit(0);
}

for (const target of targets) {
  sendSignal(target.pid, 'SIGTERM');
}

await waitForExit(targets.map((target) => target.pid), waitMs);

const stillAlive = targets.filter((target) => isAlive(target.pid));
if (stillAlive.length > 0) {
  console.log(`Force stopping ${stillAlive.length} process(es) that ignored SIGTERM.`);
  for (const target of stillAlive) {
    sendSignal(target.pid, 'SIGKILL');
  }
  await waitForExit(stillAlive.map((target) => target.pid), 500);
}

const survivors = targets.filter((target) => isAlive(target.pid));
if (survivors.length > 0) {
  console.error('Some processes are still alive:');
  for (const target of survivors) {
    console.error(`- ${target.pid} ${target.command}`);
  }
  process.exit(1);
}

console.log('Cleanup complete.');

function readNumberArg(name, fallback) {
  const prefix = `${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readProcessTable() {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,stat=,command='], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/))
    .filter(Boolean)
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      stat: match[3],
      command: match[4],
    }));
}

function groupByParent(rows) {
  const result = new Map();
  for (const row of rows) {
    const children = result.get(row.ppid) ?? [];
    children.push(row);
    result.set(row.ppid, children);
  }
  return result;
}

function isDirectTarget(row) {
  if (row.pid === process.pid || row.ppid === process.pid) return false;
  if (!looksLikeTelegraphDevProcess(row.command)) return false;
  return isInRepo(row.pid, row.command);
}

function looksLikeTelegraphDevProcess(command) {
  if (command.includes('cleanup-dev-processes.mjs')) return false;
  if (command.includes('cleanup:dev')) return false;

  return [
    /\bnode \(vitest(?:\s|\)|$)/,
    /(?:^|\s)vitest(?:\s|$)/,
    /(?:^|\s)vite(?:\s|$)/,
    /(?:^|\s)vitepress(?:\s|$)/,
    /electron-forge/,
    /@electron-forge/,
    /(?:^|\s)electron(?:\s|$)/,
    /\bpnpm\b.*\b(start|dev|test|test:watch|docs:wiki:dev)\b/,
  ].some((pattern) => pattern.test(command));
}

function isInRepo(pid, command) {
  if (command.includes(repoRoot)) return true;
  const cwd = readProcessCwd(pid);
  return Boolean(cwd && isPathInside(cwd, repoRoot));
}

function readProcessCwd(pid) {
  try {
    const output = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output
      .split('\n')
      .find((line) => line.startsWith('n'))
      ?.slice(1);
  } catch {
    return undefined;
  }
}

function isPathInside(candidate, root) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function addDescendants(pid, byParentMap, targetPids) {
  for (const child of byParentMap.get(pid) ?? []) {
    if (child.pid === process.pid || targetPids.has(child.pid)) continue;
    targetPids.add(child.pid);
    addDescendants(child.pid, byParentMap, targetPids);
  }
}

function processDepth(pid, byParentMap) {
  let maxDepth = 0;
  for (const child of byParentMap.get(pid) ?? []) {
    maxDepth = Math.max(maxDepth, 1 + processDepth(child.pid, byParentMap));
  }
  return maxDepth;
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      console.warn(`Could not send ${signal} to ${pid}: ${error?.message ?? String(error)}`);
    }
  }
}

async function waitForExit(pids, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pids.every((pid) => !isAlive(pid))) return;
    await delay(100);
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
