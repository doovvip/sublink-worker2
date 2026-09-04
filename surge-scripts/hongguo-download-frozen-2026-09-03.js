// 红果短剧 Surge 实验脚本：下载限制响应修改
// 仅修改原 Xposed 项目对应的明确配置字段。

const body = $response.body || "";
let obj;
try { obj = JSON.parse(body); } catch (e) { $done({}); }

let changed = false;
const keys = new Set([
  "one_day_max_episode_limit",
  "one_day_max_series_limit",
  "total_max_series_limit"
]);

function walk(v, depth=0) {
  if (!v || typeof v !== "object" || depth > 12) return;
  for (const k of Object.keys(v)) {
    if (keys.has(k)) {
      const old = v[k];
      if (typeof old === "number") v[k] = 99999;
      else if (typeof old === "string") v[k] = "99999";
      else continue;
      changed = true;
    }
    if (v[k] && typeof v[k] === "object") walk(v[k], depth + 1);
  }
}

walk(obj);
$done(changed ? { body: JSON.stringify(obj) } : {});
