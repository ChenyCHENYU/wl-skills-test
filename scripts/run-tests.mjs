import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Pass actual paths to Node so Windows and POSIX run the same complete suite.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tests = readdirSync(join(root, 'test'))
  .filter(name => name.endsWith('.test.js'))
  .sort()
  .map(name => join(root, 'test', name));
if (!tests.length) throw new Error('No test/*.test.js files found.');
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
