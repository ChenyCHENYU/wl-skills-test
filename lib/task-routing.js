import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PKG_ROOT, PKG } from './cli/context.js';
import taskIntent from './task-intent.cjs';
import integrationSupport from './project-integration.cjs';

export const ROUTES_PATH = '.wl-skills-test/routes.v1.json';
const routeSource = path.join(PKG_ROOT, 'files', ROUTES_PATH);
const sha256 = value => createHash('sha256').update(value).digest('hex');
export function readRoutes(root) {
  const source = root ? integrationSupport.resolveResourcePath(root, ROUTES_PATH, PKG_ROOT) : routeSource;
  const value = JSON.parse(fs.readFileSync(source, 'utf8'));
  if (value.schemaVersion !== 1 || value.package !== PKG.name || !Array.isArray(value.skills)) throw new Error('Unsupported test route manifest');
  for (const skill of value.skills) {
    if (skill.combinations !== undefined && (!Array.isArray(skill.combinations) || !skill.combinations.every(combination => combination
        && [combination.verbs, combination.objects].every(list => Array.isArray(list) && list.length && list.every(item => typeof item === 'string' && item.trim()))
        && (combination.exclude === undefined || Array.isArray(combination.exclude) && combination.exclude.every(item => typeof item === 'string' && item.trim()))))) throw new Error(`Invalid task combinations: ${skill.id}`);
  }
  return value;
}
function phraseMatch(text, phrase) {
  const haystack = text.toLowerCase().normalize('NFKC');
  const needle = phrase.toLowerCase().normalize('NFKC');
  let offset = -1;
  while ((offset = haystack.indexOf(needle, offset + 1)) >= 0) {
    if (/[\u3400-\u9fff]/u.test(needle)) return true;
    if (!/[a-z0-9_-]/i.test(haystack[offset - 1] || '') && !/[a-z0-9_-]/i.test(haystack[offset + needle.length] || '')) return true;
  }
  return false;
}
function negatedMatch(text, phrase) {
  const at = text.toLowerCase().indexOf(phrase.toLowerCase());
  return at >= 0 && /(?:不要|不用|无需|不做|不生成|不执行|别|without|do not|don't|skip)\s*(?:生成|执行|编写|做|write|run)?\s*$/iu.test(text.slice(Math.max(0, at - 20), at));
}
function matchingCombinations(text, combinations = []) {
  // Commas can continue one object ("a minimal, stable smoke suite"). Only
  // sentence or explicit workflow boundaries end the bounded relation.
  const clauses = text.split(/[。；;\n]|并且?|同时|然后|另外/u);
  return combinations.flatMap(({ verbs, objects, exclude = [] }) => clauses.flatMap(clause => {
    if (exclude.some(phrase => phraseMatch(clause, phrase))) return [];
    const verb = verbs.find(value => taskIntent.phraseMatches(clause, value));
    const object = objects.find(value => taskIntent.phraseMatches(clause, value));
    if (!verb || !object || Math.abs(clause.toLowerCase().indexOf(verb.toLowerCase()) - clause.toLowerCase().indexOf(object.toLowerCase())) > 40) return [];
    return [`${verb} + ${object}`];
  }));
}
function candidateFocus(text) {
  const parts = text.split(/([,，。；;\n]|并且?|同时|然后|另外)/u);
  const production = /生成|编写|构建|设计(?!方案|文档|说明|规范|标准|模型|结果|图|稿)|执行|运行/gu;
  return parts.map((part, index) => part.replace(/(?:根据|依据|基于|参考|按(?:照)?)([^,，。；;\n]{1,64})/gu, (whole, reference) => {
    const verbs = [...reference.matchAll(production)];
    if (verbs.length) {
      const at = verbs.at(-1).index;
      const prohibition = reference.slice(0, at).match(/(?:不要|不用|无需|禁止|不得|不可|不能|别|不再|不|do not|don't)\s*$/iu)?.[0] || '';
      return prohibition + reference.slice(at);
    }
    if (/^[,，]$/u.test(parts[index + 1] || '') && /^\s*(?:请|先|帮我)?\s*(?:生成|编写|构建|设计|执行|运行)/u.test(parts[index + 2] || '')) return '';
    return whole;
  })).join('');
}
function fileEvidence(root, relative, installed) {
  const full = installed ? integrationSupport.resolveResourcePath(root, relative, PKG_ROOT) : path.resolve(root, relative);
  if (!full) return { path: relative, status: 'missing' };
  try {
    const s = fs.lstatSync(full);
    if (!s.isFile() || s.isSymbolicLink()) return { path: relative, status: 'invalid' };
    const body = fs.readFileSync(full);
    const text = body.toString('utf8');
    if (relative.endsWith('/SKILL.md') && (!/^---\r?\n[\s\S]*?\bname:\s*[a-z0-9-]+[\s\S]*?---/m.test(text) || text.trim().length < 50)) return { path: relative, status: 'invalid', reason: 'Skill frontmatter/content invalid' };
    if (relative.startsWith('.github/standards/') && (!/^#\s+\S/m.test(text) || text.trim().length < 50)) return { path: relative, status: 'invalid', reason: 'Required standard content invalid' };
    return { path: full, resourceId: relative, status: 'available', sha256: sha256(body) };
  } catch { return { path: relative, status: 'missing' }; }
}

/** Deterministic routing proposes work; it never executes checks or claims host loading. */
export function routeTask(task, { root = process.cwd(), context = {}, skill, manifest = readRoutes(root), installed = true } = {}) {
  if (typeof task !== 'string' || !task.trim()) throw new Error('请提供任务描述。');
  root = path.resolve(root);
  const taskEvidence = taskIntent.analyzeTask(task);
  const text = taskEvidence.activeText;
  const focus = candidateFocus(text);
  const files = Array.isArray(context.files) ? context.files.filter(p => typeof p === 'string') : [];
  const testFileContext = files.some(p => /(?:^|\/)(?:tests?|e2e)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(p));
  const codeContext = files.some(p => /\.(?:vue|[cm]?[jt]sx?|java|sql|s?css)$/i.test(p));
  const testSignal = /测试|用例|冒烟|压测|缺陷指数|DI\s*分析|上线判定|\b(?:tests?|testing|jmeter|playwright|e2e|jtl|quality\s+gate)\b/iu.test(text) || testFileContext || context.domain === 'testing';
  const codeSignal = codeContext || /修复|重构|代码|组件|页面|接口|\b(?:fix|refactor|code|component|api)\b/iu.test(text);
  const outside = ['design', 'style', 'documentation'].includes(context.domain) && !testSignal && !codeContext;
  const candidates = manifest.skills.map(entry => {
    const matchedPhrases = entry.phrases.filter(p => phraseMatch(focus, p) && !negatedMatch(focus, p));
    const matchedCombinations = matchingCombinations(focus, entry.combinations);
    const exclusions = (entry.exclude || []).filter(p => phraseMatch(text, p));
    const explicit = skill === entry.id || text === entry.id;
    const score = exclusions.length ? 0 : explicit ? 100 : matchedCombinations.length ? 10 + (testFileContext ? 1 : 0) : matchedPhrases.length ? 6 + Math.min(4, matchedPhrases.length - 1) + (testFileContext ? 1 : 0) : 0;
    return { id: entry.id, name: entry.name, description: entry.description, path: entry.path, score, matchedPhrases, matchedCombinations, exclusions, standards: entry.standards, constraints: entry.constraints };
  }).filter(c => c.score > 0 || c.exclusions.length).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  // A more specific phrase owns its nested generic phrase (performance plan vs test plan).
  // Independent requested workflows still remain ambiguous.
  for (const candidate of candidates) {
    if (candidate.score < 100 && candidate.matchedPhrases.length && candidate.matchedPhrases.every(phrase => candidates.some(other => other.id !== candidate.id && other.matchedPhrases.some(p => p.length > phrase.length && p.toLowerCase().includes(phrase.toLowerCase()))))) candidate.score = Math.max(0, candidate.score - manifest.minimumLead);
  }
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const eligible = candidates.filter(c => c.score >= manifest.minimumScore);
  const unresolvedScript = matchingCombinations(focus, [{ verbs: ['生成', '编写', '构建'], objects: ['脚本'] }]).length > 0
    && !eligible.some(candidate => ['test-script-generator', 'perf-script-generator'].includes(candidate.id));
  let status, selected = [], reason;
  if (skill && !manifest.skills.some(s => s.id === skill)) {
    status = 'gap'; reason = `本包未提供显式技能 ${skill}`;
  } else if (!text && taskEvidence.excluded.some(item => item.kind === 'prohibited')) {
    status = 'not-applicable'; reason = '当前请求仅禁止动作，没有要求本包执行工作。';
  } else if (outside) { status = 'not-applicable'; reason = '当前任务领域不属于测试。'; }
  else if (!skill && unresolvedScript && eligible.length) {
    status = 'ambiguous'; reason = '同时要求尚未明确类型的脚本生成与其他测试工作流；请明确脚本类型或分别执行。';
  } else if (eligible.length > 1 && eligible[0].score - eligible[1].score < manifest.minimumLead) {
    status = 'ambiguous'; reason = '多个测试工作流得分接近；需明确先执行哪个。';
  } else if (eligible.length) { status = 'matched'; selected = [eligible[0]]; reason = `匹配 ${eligible[0].id}，达到阈值与领先分差。`; }
  else if (candidates.some(c => c.exclusions.length) && !codeSignal) { status = 'not-applicable'; reason = '用户明确排除了匹配的测试工作流。'; }
  else if (candidates.some(c => c.exclusions.length) && codeSignal) { status = 'baseline'; reason = '专项测试工作流被排除；代码变更仍适用测试基线。'; }
  else if (codeSignal && /审计|审查|检查|评审|\b(?:audit|review|inspect|check)\b/iu.test(text)) { status = 'baseline'; reason = '审查现有代码适用测试基线；不推断需要生成测试用例。'; }
  else if (testSignal) { status = 'gap'; reason = '任务需要测试能力，但现有技能未达到明确匹配阈值。'; }
  else if (codeSignal) { status = 'baseline'; reason = '代码任务适用测试基线；没有选定专项测试工作流。'; }
  else if (/验证|检查|\b(?:review|check|verify)\b/iu.test(text)) { status = 'needs-context'; reason = '缺少任务领域或目标文件，无法判断测试约束是否适用。'; }
  else if (/天气|菜谱|旅行|旅游|写(?:一首|首)?诗|诗词|\b(?:weather|travel|recipe|poem)\b/iu.test(text)) { status = 'not-applicable'; reason = '任务有明确测试职责外证据。'; }
  else { status = 'needs-context'; reason = '任务目标尚不明确，缺少判定测试约束是否适用的证据。'; }
  const requiredPaths = [...new Set([
    ...(['matched', 'baseline'].includes(status) ? [ROUTES_PATH] : []),
    ...selected.map(s => s.path),
    ...selected.flatMap(s => s.standards.map(s => `.github/standards/${s}`)),
    ...(status === 'baseline' ? manifest.baselineStandards.map(s => `.github/standards/${s}`) : []),
  ])];
  const evidenceRoot = installed ? root : path.join(PKG_ROOT, 'files');
  const requiredFiles = requiredPaths.map(p => fileEvidence(evidenceRoot, p, installed));
  const missing = requiredFiles.filter(f => f.status !== 'available');
  const gaps = [];
  if (missing.length) {
    gaps.push({ kind: 'missing-required-file', reason: '缺少所选技能或必要规范', paths: missing.map(f => f.path), suggestion: '安装或恢复本包缺失文件，再重新路由；已有本地修改先合并。' });
    status = 'gap'; reason = '已选定工作流所需技能或规范文件缺失，不能宣称约束就绪。';
  }
  if (status === 'gap' && !gaps.length) gaps.push({ kind: 'capability-gap', reason, task: text, suggestion: '补充任务范围或本包技能触发描述；记录一个最小复现任务后再完善能力，不猜测工作流。' });
  const sitDeliveryCheck = /SIT(?:测试问题记录|测试报告|两轮全量执行|交付校验)|转UAT验收/i.test(text);
  const requiredChecks = status === 'baseline' ? ['changed-behavior-tests'] : selected.map(s => s.id === 'test-quality-analyzer' && sitDeliveryCheck ? 'sit-delivery-checks' : ({ 'smoke-test-executor': 'api-assertions', 'test-script-generator': 'test-code-audit', 'universal-test-rules': 'test-code-audit', 'test-quality-analyzer': 'quality-gate', 'perf-report-analyzer': 'performance-samples' }[s.id] || s.id));
  return {
    schemaVersion: 1, package: PKG.name, packageVersion: PKG.version, domain: 'testing', status,
    task: task.trim(), taskEvidence, action: taskEvidence.action, root, reason, reasons: [reason], requiredRules: status === 'baseline' ? ['根据改动验证真实行为', '测试数据隔离与清理'] : selected.flatMap(s => s.constraints), requiredChecks, baselineRules: status === 'baseline' ? ['根据改动验证真实行为', '测试数据隔离与清理'] : [], thresholds: { minimumScore: manifest.minimumScore, minimumLead: manifest.minimumLead },
    context: { domain: context.domain || 'auto', files }, candidates, selectedSkills: selected.map(s => s.id),
    skillDetails: selected.map(s => ({ id: s.id, name: s.name || s.id, description: s.description })),
    skillPaths: selected.map(s => integrationSupport.resolveResourcePath(root, s.path, PKG_ROOT)), requiredFiles: requiredFiles.map(item => item.path), resourceIds: requiredPaths, fileEvidence: requiredFiles,
    constraints: selected.length ? selected.flatMap(s => s.constraints) : status === 'baseline' ? ['按实际改动确定测试范围；没有执行的检查必须标明未验证。', 'API 事实、环境授权与数据清理不能从页面路由或技能匹配推断。'] : [],
    gaps, question: status === 'needs-context' ? '请明确要检查的目标文件或任务领域。' : status === 'ambiguous' ? `先执行 ${eligible.slice(0, 3).map(c => c.id).join(' / ')} 中哪个工作流？` : null,
    evidenceLevel: 'static-routing-and-file-hashes', hostContextLoaded: 'unknown', compliance: 'unverified',
  };
}
