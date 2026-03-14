#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('Usage: node invoke_mulby_cli.mjs <mulby arguments>');
  process.exit(1);
}

try {
  const strategy = resolveStrategy(process.cwd());
  const result = spawnSync(strategy.command, [...strategy.prefixArgs, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  process.exit(result.status ?? 0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to invoke Mulby CLI: ${message}`);
  process.exit(1);
}

function resolveStrategy(startDir) {
  const envEntry = process.env.MULBY_CLI_ENTRY;
  if (envEntry) {
    return {
      command: process.execPath,
      prefixArgs: [resolve(envEntry)],
    };
  }

  const envBin = process.env.MULBY_CLI_BIN;
  if (envBin) {
    return {
      command: envBin,
      prefixArgs: [],
    };
  }

  const localBin = findUp(startDir, (dir) => {
    const candidate = join(
      dir,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'mulby.cmd' : 'mulby',
    );
    return existsSync(candidate) ? candidate : null;
  });

  if (localBin) {
    return {
      command: localBin,
      prefixArgs: [],
    };
  }

  if (canRun('mulby', ['--version'])) {
    return {
      command: 'mulby',
      prefixArgs: [],
    };
  }

  if (canRun('npx', ['--yes', 'mulby-cli@latest', '--version'])) {
    return {
      command: 'npx',
      prefixArgs: ['--yes', 'mulby-cli@latest'],
    };
  }

  throw new Error(
    [
      'No usable Mulby CLI was found.',
      'Set MULBY_CLI_ENTRY to a Mulby CLI entry file,',
      'set MULBY_CLI_BIN to a Mulby executable,',
      'install mulby-cli locally or globally,',
      'or ensure npx can download mulby-cli.',
    ].join(' '),
  );
}

function canRun(command, probeArgs) {
  const result = spawnSync(command, probeArgs, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'ignore',
    shell: false,
  });

  if (result.error) {
    return false;
  }

  return (result.status ?? 1) === 0;
}

function findUp(startDir, resolver) {
  let current = resolve(startDir);

  while (true) {
    const resolved = resolver(current);
    if (resolved) {
      return resolved;
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}
