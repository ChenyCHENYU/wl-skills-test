/**
 * dict-sync.js — 系统字典同步（v0.10.0）
 *
 * 从被测系统拉取字典，归一化为 { dictCode: [合法值] } 供数据工厂/负例/round2 消费：
 *   wl-skills-test dict-sync --base-url http://sit --token xxx --output e2e/fixtures/dict.json
 *
 * 兼容三种响应形态（自动识别）:
 *   1. { code, data: { dictCode: ["A","B"] } }         — map of arrays
 *   2. { code, data: [{ code/DictCode, items/rows }] } — 列表式（jh4j 常见）
 *   3. { code, data: { dictCode: [{value,label}] } }    — map of item-arrays
 *
 * 字段级映射：--map 字段名=字典码（可多次），输出同时写入 __fieldMap__ 供 run-api --dict-file 使用。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

function normalizeDict(data) {
  const out = {};
  if (Array.isArray(data)) {
    // 列表式: [{ code | dictCode | dict, items | rows | values }]
    for (const entry of data) {
      const code = entry?.code ?? entry?.dictCode ?? entry?.dict ?? entry?.type;
      const items = entry?.items ?? entry?.rows ?? entry?.values ?? entry?.list;
      if (!code || !Array.isArray(items)) continue;
      const values = items
        .map((it) => (typeof it === "object" && it !== null ? (it.value ?? it.itemValue ?? it.code) : it))
        .filter((v) => v !== undefined && v !== null && v !== "");
      if (values.length > 0) out[String(code)] = values;
    }
    return out;
  }
  if (data && typeof data === "object") {
    for (const [code, val] of Object.entries(data)) {
      if (Array.isArray(val)) {
        const values = val
          .map((it) => (typeof it === "object" && it !== null ? (it.value ?? it.itemValue ?? it.code) : it))
          .filter((v) => v !== undefined && v !== null && v !== "");
        if (values.length > 0) out[String(code)] = values;
      } else if (val && typeof val === "object" && Array.isArray(val.items)) {
        const values = val.items
          .map((it) => (typeof it === "object" && it !== null ? (it.value ?? it.itemValue ?? it.code) : it))
          .filter((v) => v !== undefined && v !== null && v !== "");
        if (values.length > 0) out[String(code)] = values;
      }
    }
  }
  return out;
}

/**
 * @param {object} options — { baseUrl, token, dictApi, output, maps, successCode, timeout }
 * @returns {Promise<{dictCodes:number, totalValues:number, output:string, samples:object}>}
 */
export async function syncDict(options = {}) {
  const {
    baseUrl,
    token,
    dictApi = "/pl/system/dict/all",
    output = "./dict.json",
    maps = [],
    successCode = 2000,
    timeout = 15000,
  } = options;

  if (!baseUrl) return { error: "需要 baseUrl 参数" };

  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = /^(bearer|basic)\s/i.test(token) ? token : `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let json;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}${dictApi}`, { headers, signal: controller.signal });
    const text = await res.text();
    json = JSON.parse(text);
    if (!res.ok || (json.code !== undefined && json.code !== successCode && json.code !== 0 && json.code !== 200)) {
      return { error: `字典接口失败: HTTP ${res.status} code=${json.code} message=${json.message ?? ""}` };
    }
  } catch (e) {
    return { error: `字典接口请求失败: ${e.name === "AbortError" ? `超时 (${timeout}ms)` : e.message}` };
  } finally {
    clearTimeout(timer);
  }

  const dict = normalizeDict(json?.data ?? json);
  const dictCodes = Object.keys(dict).length;
  if (dictCodes === 0) {
    return { error: "字典响应中未识别到任何字典项（检查 dictApi 路径或响应形态）" };
  }

  // 字段级映射（--map 字段=字典码）
  const fieldMap = {};
  for (const m of maps) {
    const idx = m.indexOf("=");
    if (idx > 0) {
      const field = m.slice(0, idx).trim();
      const code = m.slice(idx + 1).trim();
      if (dict[code]) fieldMap[field] = code;
    }
  }
  if (Object.keys(fieldMap).length > 0) dict.__fieldMap__ = fieldMap;

  mkdirSync(dirname(output.replace(/\\/g, "/")), { recursive: true });
  writeFileSync(output, JSON.stringify(dict, null, 2), "utf-8");

  const totalValues = Object.entries(dict)
    .filter(([k]) => k !== "__fieldMap__")
    .reduce((n, [, v]) => n + v.length, 0);
  const samples = Object.fromEntries(Object.entries(dict).slice(0, 5));

  return { dictCodes, totalValues, output, samples };
}
