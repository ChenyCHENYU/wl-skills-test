/**
 * cli/args.js — CLI 参数解析（布尔归一 / 防止 flag 误吞）
 *
 * 布尔归一：--flag=true → true / --flag=false → false，
 * 否则 `--dry-run=true` 会以字符串 `"true"` 参与 === true 判断而静默失效（真实写盘）。
 */
export function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx > -1) {
        const raw = arg.slice(eqIdx + 1);
        opts[arg.slice(2, eqIdx)] = raw === "true" ? true : raw === "false" ? false : raw;
      } else {
        const key = arg.slice(2);
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          opts[key] = next;
          i++;
        } else {
          opts[key] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { opts, positional };
}
