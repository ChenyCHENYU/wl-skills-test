/**
 * cli/webhook.js — 质量门/报告结论推送（wecom / dingtalk / feishu / raw）
 */

// 消息体构造（导出以便测试断言形状，不依赖网络）
export function buildWebhookBody(type, verdict, checks) {
  const failed = (checks || []).filter((c) => !c.pass);
  const lines = [`**${verdict}**`];
  if (failed.length > 0) {
    lines.push("", "未通过项:");
    for (const f of failed.slice(0, 8)) lines.push(`- ✗ ${f.name}: ${f.detail}`);
  } else {
    lines.push("", "全部检查通过 ✅");
  }
  const content = lines.join("\n");
  if (type === "dingtalk") {
    return { msgtype: "markdown", markdown: { title: "质量门", text: content } };
  }
  if (type === "raw") {
    return { verdict, checks };
  }
  if (type === "feishu") {
    return { msg_type: "text", content: { text: content.replace(/\*\*/g, "") } };
  }
  // wecom（默认）
  return { msgtype: "markdown", markdown: { content: content.slice(0, 4000) } };
}

export async function pushWebhook(url, type, verdict, checks) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWebhookBody(type, verdict, checks)),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? "" : await res.text().catch(() => "") };
  } catch (e) {
    return { ok: false, detail: e.message };
  } finally {
    clearTimeout(timer);
  }
}
