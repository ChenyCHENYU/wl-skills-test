/**
 * report/html.js — 单文件 HTML 交互报告（v0.19.0，零依赖）
 *
 * 数据以 JSON 内嵌 + 原生 JS 渲染：失败筛选、检查项展开、诊断指引随行。
 * AI/推送只发链接或文件，token 零消耗；人打开即用。
 */
import { computeQualityScore } from "../quality-score.js";

export function renderHtmlReport(result, { title } = {}) {
  const score = computeQualityScore(result.checks);
  const data = {
    title: title || "测试报告",
    generatedAt: new Date().toISOString(),
    pass: result.pass,
    decision: result.decision,
    score: score.score,
    level: score.level,
    checks: result.checks,
    snapshot: result.snapshot,
    sourceErrors: result.sourceErrors ?? [],
  };
  const json = JSON.stringify(data).replaceAll("</", "<\\/");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f6f7f9;color:#1f2328}
  header{background:linear-gradient(135deg,#1f3a5f,#2d6a9f);color:#fff;padding:24px 32px}
  header h1{margin:0 0 6px;font-size:22px}
  header .meta{opacity:.85;font-size:13px}
  .badges{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap}
  .badge{background:rgba(255,255,255,.15);border-radius:999px;padding:3px 12px;font-size:13px}
  .badge.fail{background:#c0392b}
  .badge.score{background:rgba(255,255,255,.25);font-weight:600}
  main{max-width:960px;margin:24px auto;padding:0 16px}
  .toolbar{display:flex;gap:8px;margin-bottom:12px}
  button{border:1px solid #d0d7de;background:#fff;border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
  button.active{background:#1f3a5f;color:#fff;border-color:#1f3a5f}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden}
  th,td{padding:10px 12px;border-bottom:1px solid #eaeef2;text-align:left;font-size:14px;vertical-align:top}
  th{background:#f0f3f6;font-size:13px}
  tr.fail{background:#fff5f5}
  .ok{color:#1a7f37;font-weight:600}
  .no{color:#c0392b;font-weight:600}
  footer{color:#8b949e;font-size:12px;text-align:center;padding:16px 0 32px}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="meta">生成时间: ${escapeHtml(data.generatedAt)}</div>
  <div class="badges">
    <span class="badge ${data.pass ? "" : "fail"}">${data.pass ? "✅ 具备上线条件" : "❌ 不具备上线条件"}</span>
    ${data.score !== null ? `<span class="badge score">质量分 ${data.score}（${data.level}）</span>` : ""}
    <span class="badge">检查项 ${data.checks.length}</span>
  </div>
</header>
<main>
  <div class="toolbar">
    <button class="active" data-filter="all" onclick="filter('all',this)">全部</button>
    <button data-filter="fail" onclick="filter('fail',this)">仅未达标</button>
    <button data-filter="pass" onclick="filter('pass',this)">仅通过</button>
  </div>
  <table>
    <thead><tr><th style="width:64px">判定</th><th>检查项</th><th>详情</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
</main>
<footer>wl-skills-test 单文件报告 — 数据内嵌，离线可看；JSON 数据见 &lt;script id="wl-data"&gt;</footer>
<script id="wl-data" type="application/json">${json}</script>
<script>
const DATA = JSON.parse(document.getElementById("wl-data").textContent);
function esc(s){const d=document.createElement("div");d.textContent=s==null?"":String(s);return d.innerHTML;}
function render(list){
  document.getElementById("rows").innerHTML = list.map(c =>
    '<tr class="'+(c.pass?"":"fail")+'"><td>'+(c.pass?'<span class="ok">✅</span>':'<span class="no">❌</span>')+
    '</td><td>'+esc(c.name)+'</td><td>'+esc(c.detail||"")+'</td></tr>').join("") ||
    '<tr><td colspan="3" style="text-align:center;color:#8b949e">无匹配项</td></tr>';
}
function filter(mode, btn){
  document.querySelectorAll(".toolbar button").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  render(mode==="all"?DATA.checks:DATA.checks.filter(c=>mode==="pass"?c.pass:!c.pass));
}
render(DATA.checks);
</script>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
