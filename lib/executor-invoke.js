/** Package-owned invocation mapping; standalone and Harness reuse the original audit. */
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { invokeCli } = require('./executor-process.cjs');
const cli = fileURLToPath(new URL('../bin/wl-skills-test.js', import.meta.url));
export async function invokeExecutor({ executor, parameters, projectRoot, runId }) {
  if (executor.id !== 'audit') {
    const error = new Error('本包未实现此执行器'); error.code = 'unsupported-executor'; throw error;
  }
  const reportsDirectory = mkdtempSync(path.join(tmpdir(), 'wl-test-audit-reports-'));
  try {
    const execution = await invokeCli({ cli, projectRoot, args: ['audit', '--target', parameters.targets[0], '--run-id', runId,
      '--reports-dir', reportsDirectory] });
    return { ...execution, reportsDirectory };
  } catch (error) {
    rmSync(reportsDirectory, { recursive: true, force: true });
    throw error;
  }
}
