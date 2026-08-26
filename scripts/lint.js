#!/usr/bin/env node

const { existsSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const INCLUDED = ['api', 'frontend', 'packages', 'scripts', 'server', 'src', 'test'];
const IGNORED = new Set(['node_modules', '.git']);

function javascriptFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...javascriptFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

const files = INCLUDED
  .map((name) => path.join(ROOT, name))
  .filter((directory) => existsSync(directory) && statSync(directory).isDirectory())
  .flatMap(javascriptFiles)
  .sort();

let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
  }
}

if (failed) process.exitCode = 1;
else process.stdout.write(`Syntax checked ${files.length} JavaScript files.\n`);
