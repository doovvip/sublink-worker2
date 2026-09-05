const MODULES = {
  youtube: {
    label: '▶️ YouTube 净化增强｜V2.0.1',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/YouTube%E5%87%80%E5%8C%96%E5%A2%9E%E5%BC%BA-V2.0.1.sgmodule'
  },
  jd: {
    label: '🛒 京东历史比价',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/JD-Price-History.sgmodule'
  },
  startup: {
    label: '🚫 去开屏广告｜V2.0.0',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/StartUpAds-Surge-Native.sgmodule'
  },
  bili: {
    label: '📺 哔哩哔哩去广告',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/BiliBili-Surge-Native.sgmodule'
  },
  kuwo: {
    label: '🎵 酷我音乐会员解锁',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/Kuwo-Surge-Native.sgmodule'
  },
  meitu: {
    label: '✨ 美图秀秀',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/MeituXiuxiu-Unlock.sgmodule'
  },
  hongguo: {
    label: '🍅 红果短剧',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/HongGuo-Surge-Native.sgmodule'
  }
};

const SECTION_NAMES = ['Rule', 'URL Rewrite', 'Header Rewrite', 'Map Local', 'Body Rewrite', 'Script'];

function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\r?\\n\\[[^\\]]+\\]|$)`, 'i'));
  return m ? m[1].trim() : '';
}

function mitmHosts(text) {
  const block = section(text, 'MITM');
  if (!block) return [];
  const hosts = [];
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^\s*hostname\s*=\s*(?:%APPEND%\s*)?(.+)$/i);
    if (m) hosts.push(...m[1].split(',').map((x) => x.trim()).filter(Boolean));
  }
  return hosts;
}

function splitArgs(value) {
  const out = [];
  let buf = '';
  let quoted = false;
  let escape = false;
  for (const ch of value) {
    if (escape) {
      buf += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      buf += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      buf += ch;
      quoted = !quoted;
      continue;
    }
    if (ch === ',' && !quoted) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function argumentItems(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#!arguments\s*=\s*(.+)$/i);
    if (m) out.push(...splitArgs(m[1]));
  }
  return out;
}

function argumentKey(item) {
  const i = item.indexOf(':');
  return (i < 0 ? item : item.slice(0, i)).trim();
}

function normalizeKeys(value) {
  return [...new Set(String(value || '').split(',').map((x) => x.trim().toLowerCase()).filter((x) => MODULES[x]))];
}

async function loadModule(key) {
  const r = await fetch(MODULES[key].url, {
    headers: {
      'User-Agent': 'Surge-Module-Generator/1.2',
      Accept: 'text/plain,*/*'
    }
  });
  if (!r.ok) throw new Error(`${key} source returned ${r.status}`);
  return r.text();
}

export async function handleSurgeModule(request) {
  const url = new URL(request.url);
  const keys = normalizeKeys(url.searchParams.get('modules'));
  if (!keys.length) {
    return new Response('Missing modules. Example: ?modules=youtube,jd,startup,bili,kuwo,meitu,hongguo', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  try {
    const texts = await Promise.all(keys.map(loadModule));
    const buckets = Object.fromEntries(SECTION_NAMES.map((n) => [n, []]));
    const hosts = [];
    const args = new Map();

    texts.forEach((text, i) => {
      const key = keys[i];
      for (const name of SECTION_NAMES) {
        const body = section(text, name);
        if (body) buckets[name].push(`# ===== ${MODULES[key].label} =====\n${body}`);
      }
      hosts.push(...mitmHosts(text));
      for (const item of argumentItems(text)) {
        const keyName = argumentKey(item);
        if (keyName && !args.has(keyName)) args.set(keyName, item);
      }
    });

    const uniqueHosts = [...new Set(hosts)];
    const labels = keys.map((k) => MODULES[k].label.replace(/^\S+\s*/, '')).join(' + ');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '.');

    let out = `#!name = ⚡ Surge 正式母版合集\n#!desc = 动态合成｜${labels}\n#!author = doovvip\n#!category = ⚡ 正式母版\n#!version = ${stamp}\n`;
    if (args.size) out += `#!arguments = ${[...args.values()].join(',')}\n`;
    out += '\n';

    for (const name of SECTION_NAMES) {
      if (buckets[name].length) out += `[${name}]\n${buckets[name].join('\n\n')}\n\n`;
    }
    if (uniqueHosts.length) out += `[MITM]\nhostname = %APPEND% ${uniqueHosts.join(', ')}\n`;

    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="Surge-Full-Module.sgmodule"',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (e) {
    return new Response(`Module generation failed: ${e?.message || String(e)}`, {
      status: 502,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store'
      }
    });
  }
}

export function handleSurgeModuleCenter() {
  const order = ['bili', 'youtube', 'jd', 'startup', 'kuwo', 'meitu', 'hongguo'];
  const items = order.map((key) => {
    const module = MODULES[key];
    const installUrl = `surge:///install-module?url=${encodeURIComponent(module.url)}`;
    return `<div class="i"><div class="label">${module.label}</div><a class="b" href="${installUrl}">安装 / 覆盖</a></div>`;
  }).join('');

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Surge 正式模块中心</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f5f5f7;margin:0;color:#111}.w{max-width:680px;margin:auto;padding:28px 18px 48px}.c{background:#fff;border-radius:22px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.06)}h1{margin:0 0 8px}.sub{color:#666;line-height:1.6}.i{display:flex;align-items:center;gap:12px;border:1px solid #ddd;border-radius:15px;padding:13px 14px;margin:10px 0}.label{flex:1;font-size:16px;line-height:1.4}.b{display:inline-block;text-decoration:none;white-space:nowrap;padding:10px 13px;border-radius:12px;background:#0a84ff;color:#fff;font-size:14px;font-weight:700}.n{font-size:12px;color:#777;line-height:1.6;margin-top:16px}@media(prefers-color-scheme:dark){body{background:#000;color:#fff}.c{background:#1c1c1e}.i{border-color:#3a3a3c}.sub,.n{color:#aaa}}</style></head><body><div class="w"><div class="c"><h1>⚡ Surge 正式模块中心</h1><p class="sub">正式结构保持为 7 个独立模块。逐个点击“安装 / 覆盖”，不要合并成一个模块。</p>${items}<p class="n">模块源已统一到 sublink-worker2。MyCamera 继续作为独立实验/维护项，不自动并入正式 7 模块。</p></div></div></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
