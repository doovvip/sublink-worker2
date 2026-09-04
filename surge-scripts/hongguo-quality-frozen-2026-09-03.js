// 红果短剧 Surge 实验脚本：清晰度/画质权限响应修改
// 仅对明确的分辨率/质量列表做无损放宽，不伪造不存在的视频源。

const body = $response.body || "";
let obj;
try { obj = JSON.parse(body); } catch (e) { $done({}); }

let changed = false;
const boolKeys = new Set(["is_locked","locked","need_vip","needVip","vip_only","vipOnly"]);
const qualityKeys = new Set(["support_resolutions","supportResolutions","resolutions","quality_list","qualityList"]);

function unlockItem(x) {
  if (!x || typeof x !== "object") return;
  for (const k of Object.keys(x)) {
    if (boolKeys.has(k)) {
      if (typeof x[k] === "boolean" && x[k] !== false) { x[k] = false; changed = true; }
      else if (typeof x[k] === "number" && x[k] !== 0) { x[k] = 0; changed = true; }
    }
  }
}

function walk(v, depth=0) {
  if (!v || typeof v !== "object" || depth > 12) return;
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (qualityKeys.has(k) && Array.isArray(val)) {
      for (const item of val) unlockItem(item);
    }
    if (val && typeof val === "object") walk(val, depth + 1);
  }
}

walk(obj);
$done(changed ? { body: JSON.stringify(obj) } : {});
