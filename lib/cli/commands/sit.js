/** Explicit SIT document generation and read-only delivery verification. */
import fs from 'node:fs';
import path from 'node:path';
import { describeSitTemplates, generateSitDelivery } from '../../sit-delivery.js';
import { checkSitFile } from '../../sit-execution.js';

export function cmdSit({ positional = [], opts = {} }) {
  const action = positional[0];
  const emit = (value) => console.log(JSON.stringify(value, null, 2));
  try {
    if (!['templates', 'generate', 'verify'].includes(action) || positional.length !== 1) throw new Error('用法：sit templates | generate --input <sit.json> --output <new-dir> | verify --input <sit.json> --phase pre-sit|pre-uat');
    const allowed = action === 'templates' ? ['json'] : action === 'generate' ? ['input', 'output', 'json'] : ['input', 'phase', 'json', 'run-id', 'root'];
    for (const key of Object.keys(opts)) if (!allowed.includes(key)) throw new Error(`不支持的选项：--${key}`);
    if (opts.json !== undefined && opts.json !== true) throw new Error('--json 是输出开关，不接受路径或false');
    if (action === 'templates') return emit({ ok: true, result: describeSitTemplates(), diagnostics: [] });
    if (typeof opts.input !== 'string' || !opts.input.trim()) throw new Error('--input <sit.json> 必填');
    if (action === 'generate' && (typeof opts.output !== 'string' || !opts.output.trim())) throw new Error('--output <新目录> 必填');
    if (action === 'verify' && !['pre-sit', 'pre-uat'].includes(opts.phase)) throw new Error('--phase pre-sit|pre-uat 必填');
    for (const key of ['run-id', 'root']) if (opts[key] !== undefined && (typeof opts[key] !== 'string' || !opts[key].trim())) throw new Error(`--${key} 缺少有效值`);
    const inputFile = path.resolve(opts.input);
    const result = action === 'generate'
      ? generateSitDelivery(JSON.parse(fs.readFileSync(inputFile, 'utf8')), { outputDir: opts.output, evidenceRoot: path.dirname(inputFile) })
      : checkSitFile({ inputFile, phase: opts.phase, root: opts.root, runId: opts['run-id'] });
    emit({ ok: true, result, diagnostics: ['ok表示调用成功；以result.passed/validationStatus判定交付记录是否满足，生成不代表执行'] });
    if (action === 'verify' && !result.passed) process.exitCode = 1;
  } catch (error) {
    emit({ ok: false, error: { code: 'invalid-input', message: error.message }, diagnostics: [] });
    process.exitCode = 2;
  }
}
