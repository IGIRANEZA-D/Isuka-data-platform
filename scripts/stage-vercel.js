#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const ignoreLines = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8')
  .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'isuka-vercel-stage-'));
const bundleRoot = path.join(stageRoot, 'app');
const includeFilesPattern = config.functions['api/index.js'].includeFiles;
const functionPattern = includeFilesPattern.startsWith('{') && includeFilesPattern.endsWith('}')
  ? includeFilesPattern.slice(1, -1).split(',').map((value) => value.trim())
  : [includeFilesPattern];
const assembleOnly = process.argv.includes('--assemble-only');

function globRegex(pattern) {
  const normalized = pattern.replace(/\\/g, '/').replace(/\/$/, '');
  const expression = normalized.split('').map((char, index) => {
    if (char === '*' && normalized[index + 1] === '*') return '**';
    if (char === '*') return '[^/]*';
    if (char === '?') return '[^/]';
    return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
  }).join('').replaceAll('**', '.*');
  return new RegExp(`^(?:${expression})(?:/.*)?$`, 'i');
}
const ignoreMatchers = ignoreLines.map(globRegex);
function isIgnored(relativePath) {
  const value = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  return ignoreMatchers.some((matcher) => matcher.test(value));
}
function copyFile(relativePath, destinationPath = relativePath) {
  const sourcePath = path.join(root, relativePath);
  if (isIgnored(relativePath)) throw new Error(`Required deployment file is excluded by .vercelignore: ${relativePath}`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Required deployment file is missing: ${relativePath}`);
  const outputPath = path.join(bundleRoot, destinationPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.copyFileSync(sourcePath, outputPath);
}
function copyTree(relativePath, options = {}) {
  const sourcePath = path.join(root, relativePath);
  if (!fs.existsSync(sourcePath)) throw new Error(`Required deployment directory is missing: ${relativePath}`);
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const childRelative = `${relativePath}/${entry.name}`.replace(/\\/g, '/');
    if (isIgnored(childRelative)) continue;
    const childPath = path.join(sourcePath, entry.name);
    if (entry.isDirectory()) copyTree(childRelative, options);
    else if (!options.filter || options.filter(childRelative, entry.name)) copyFile(childRelative);
  }
}
function copyIncludedPattern(pattern) {
  if (pattern.includes('*') && !pattern.includes('/**/')) {
    const directory = path.dirname(pattern).replace(/\\/g, '/');
    const matcher = globRegex(path.basename(pattern));
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isFile() && matcher.test(entry.name)) copyFile(`${directory}/${entry.name}`);
    }
    return;
  }
  const [base, ...rest] = pattern.split('/**/');
  if (rest.length) {
    const basePath = path.join(root, base);
    if (!fs.existsSync(basePath)) throw new Error(`Included path is missing: ${pattern}`);
    for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
      const relative = `${base}/${entry.name}`;
      if (entry.isDirectory()) copyTree(relative, { filter: (file) => file.endsWith('.js') });
      else if (entry.name.endsWith('.js')) copyFile(relative);
    }
  } else if (pattern.endsWith('/**')) {
    copyTree(pattern.slice(0, -3));
  } else {
    copyFile(pattern);
  }
}
function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filePath) : [filePath];
  });
}
function inventory() {
  const files = walkFiles(bundleRoot).map((filePath) => ({
    path: path.relative(bundleRoot, filePath).replace(/\\/g, '/'),
    bytes: fs.statSync(filePath).size
  }));
  const functionFiles = files.filter((file) => !file.path.startsWith(`${config.outputDirectory}/`));
  const functionBytes = functionFiles.reduce((sum, file) => sum + file.bytes, 0);
  const deploymentBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const largest = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20);
  process.stdout.write(`Function bundle: ${(functionBytes / 1024 / 1024).toFixed(2)} MiB uncompressed\n`);
  process.stdout.write(`Static output: ${(files.filter((file) => file.path.startsWith(`${config.outputDirectory}/`)).reduce((sum, file) => sum + file.bytes, 0) / 1024 / 1024).toFixed(2)} MiB\n`);
  process.stdout.write(`Deployment inventory: ${(deploymentBytes / 1024 / 1024).toFixed(2)} MiB across ${files.length} files\n`);
  process.stdout.write('Largest included files:\n');
  largest.forEach((file) => process.stdout.write(`  ${(file.bytes / 1024 / 1024).toFixed(2)} MiB  ${file.path}\n`));
  if (functionBytes > 150 * 1024 * 1024) throw new Error('Function bundle exceeds the 150 MiB project target.');
  if (files.some((file) => !file.path.startsWith('backend/node_modules/')
    && /(^|\/)(\.env(\.|$)|Datasets\(2020-2025\)|microdata|tests?)(\/|$)/i.test(file.path))) {
    throw new Error('Staged deployment contains an environment file, raw survey folder, or test output.');
  }
}

try {
  fs.mkdirSync(bundleRoot, { recursive: true });
  copyFile('vercel.json');
  copyFile('api/index.js');
  copyFile('backend/package.json');
  copyTree('backend/src', { filter: (relative) => relative.endsWith('.js') });
  copyTree('backend/data/dist');
  copyFile('backend/data/default-overview-cache.json');
  copyFile('backend/data/forecast-cache.json');
  for (const pattern of functionPattern) copyIncludedPattern(pattern);
  copyTree(config.outputDirectory);
  const backendModules = path.join(root, 'backend', 'node_modules');
  if (fs.existsSync(backendModules)) fs.cpSync(backendModules, path.join(bundleRoot, 'backend', 'node_modules'), {
    recursive: true,
    filter: (source) => !/(^|[\\/])(test|tests|__tests__)([\\/]|$)/i.test(path.relative(backendModules, source))
  });
  else throw new Error('backend/node_modules is missing; install backend production dependencies before staging.');
  inventory();
  process.stdout.write(`Stage directory: ${bundleRoot}\n`);
  if (assembleOnly) process.exit(0);

  const engine = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).engines.node;
  const nodeMajor = String(engine).match(/\d+/)?.[0];
  if (!nodeMajor) throw new Error(`Could not determine the Node runtime from engines.node=${engine}`);
  const dockerCheck = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8' });
  if (dockerCheck.error || dockerCheck.status !== 0) throw new Error('Docker is unavailable. Install/start Docker Desktop, then rerun npm run stage:vercel.');
  const harness = path.join(__dirname, 'stage-vercel-runtime.js');
  const docker = spawnSync('docker', [
    'run', '--rm', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '-v', `${bundleRoot}:/app:ro`, '-v', `${harness}:/harness.js:ro`, '-w', '/app',
    '-e', 'VERCEL=1', '-e', 'NODE_ENV=production', '-e', 'DATA_UPLOAD_ENABLED=false', '-e', 'TRUST_PROXY=1',
    `node:${nodeMajor}-slim`, 'node', '/harness.js'
  ], { stdio: 'inherit' });
  if (docker.error) throw docker.error;
  if (docker.status !== 0) process.exitCode = docker.status || 1;
} catch (error) {
  process.stderr.write(`[stage:vercel] FAIL: ${error.message}\n`);
  process.exitCode = 1;
}
