/** One file/check/receipt path shared by CLI, MCP and protocol executor. */
import fs from 'node:fs';
import path from 'node:path';
import { verifySitDelivery, sitEvidencePaths, validateSitInput } from './sit-delivery.js';
import { observeSync } from './observed-execution.js';

export function checkSitFile({ inputFile, phase, root, runId }) {
  const file = path.resolve(inputFile), evidenceRoot = path.dirname(file);
  const input = validateSitInput(JSON.parse(fs.readFileSync(file, 'utf8')));
  const checkedFiles = [file, ...sitEvidencePaths(input, evidenceRoot)];
  const check = () => ({ ...verifySitDelivery(input, { phase, evidenceRoot }), checkedFiles });
  return runId ? observeSync('sit-verify', { root: root || evidenceRoot, runId }, checkedFiles, check) : check();
}
