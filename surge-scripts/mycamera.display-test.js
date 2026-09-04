const body = $response.body || "";

function transform(value) {
  if (Array.isArray(value)) return value.map(transform);
  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && /^(title|label|text|desc|description|display_name|status_text|name)$/i.test(k)) {
      if (/会员|普通用户|非会员|member|vip/i.test(v)) {
        out[k] = "测试会员（仅显示）";
        continue;
      }
    }
    out[k] = transform(v);
  }

  if (!Object.prototype.hasOwnProperty.call(out, "__mycamera_display_test")) {
    out.__mycamera_display_test = "TEST_ONLY";
  }
  return out;
}

try {
  const obj = JSON.parse(body);
  const result = transform(obj);

  console.log("[MyCamera Display Test] URL: " + $request.url);
  console.log("[MyCamera Display Test] display-only marker injected");

  $done({ body: JSON.stringify(result) });
} catch (e) {
  console.log("[MyCamera Display Test] Non-JSON response: " + $request.url);
  $done({});
}
