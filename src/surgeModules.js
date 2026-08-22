const MODULES = {
  bili: {
    label: '📺 BiliBili 净化增强',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/BiliBili_CN-V1.sgmodule'
  },
  youtube: {
    label: '▶️ YouTube 净化增强',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/YouTube%E5%87%80%E5%8C%96%E5%A2%9E%E5%BC%BA.sgmodule'
  },
  ximalaya: {
    label: '🎧 喜马拉雅净化增强',
    url: 'https://raw.githubusercontent.com/doovvip/sublink-worker2/main/surge-modules/%E5%96%9C%E9%A9%AC%E6%8B%89%E9%9B%85%E5%87%80%E5%8C%96%E5%A2%9E%E5%BC%BA%E6%96%B0%E7%89%88.sgmodule'
  },
  startup: {
    label: '🚫 全局开屏去广告增强',
    url: 'https://raw.githubusercontent.com/Walvez/surge-startup-ads/main/dist/StartUpAds_Selected.sgmodule'
  }
};

const SECTION_NAMES = ['Rule', 'URL Rewrite', 'Header Rewrite', 'Map Local', 'Body Rewrite', 'Script'];

function section(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function mitmHosts(text) {
  const block = section(text, 'MITM');
  if (!block) return [];
  const hosts = [];
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^\s*hostname\s*=\s*(?:%APPEND%\s*)?(.+)$/i);
    if (!match) continue;
    hosts.push(...match[1].split(',').map(x => x.trim()).filter(Boolean));
  }
  return hosts;
}

function normalizeKeys(value) {
  return [...new Set(String(value || '')
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(x => MODULES[x]))];
}

async function loadModule(key) {
  const response = await fetch(MODULES[key].url, {
    headers: { 'User-Agent': 'Surge-Module-Generator/1.0', 'Accept': 'text/plain,*/*' }
  });
  if (!response.ok) throw new Error(`${key} source returned ${response.status}`);
  return response.text();
}

export async function handleSurgeModule(request) {
  const url = new URL(request.url);
  const keys = normalizeKeys(url.searchParams.get('modules'));
  if (!keys.length) {
    return new Response('Missing modules. Example: ?modules=bili,youtube,startup', {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  try {
    const texts = await Promise.all(keys.map(loadModule));
    const buckets = Object.fromEntries(SECTION_NAMES.map(name => [name, []]));
    const hosts = [];

    texts.forEach((text, index) => {
      const key = keys[index];
      for (const name of SECTION_NAMES) {
        const body = section(text, name);
        if (body) buckets[name].push(`# ===== ${MODULES[key].label} =====\n${body}`);
      }
      hosts.push(...mitmHosts(text));
    });

    const uniqueHosts = [...new Set(hosts)];
    const labels = keys.map(key => MODULES[key].label.replace(/^\S+\s*/, '')).join(' + ');
    const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '.');
    let output = `#!name = ⚡ Surge 全功能合集\n#!desc = 动态合成｜${labels}\n#!author = doovvip\n#!category = ⚡ 懒人合集\n#!version = ${stamp}\n\n`;

    for (const name of SECTION_NAMES) {
      if (buckets[name].length) output += `[${name}]\n${buckets[name].join('\n\n')}\n\n`;
    }
    if (uniqueHosts.length) output += `[MITM]\nhostname = %APPEND% ${uniqueHosts.join(', ')}\n`;

    return new Response(output, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'inline; filename="Surge-Full-Module.sgmodule"',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (error) {
    return new Response(`Module generation failed: ${error?.message || String(error)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}

export function handleSurgeModuleCenter(request) {
  const origin = new URL(request.url).origin;
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Surge 动态模块中心</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;background:#f5f5f7;margin:0;color:#111}.w{max-width:680px;margin:auto;padding:28px 18px 48px}.c{background:#fff;border-radius:22px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,.06)}h1{margin:0 0 8px}.sub{color:#666;line-height:1.5}.i{display:block;border:1px solid #ddd;border-radius:15px;padding:14px;margin:10px 0}.i input{width:20px;height:20px;vertical-align:-3px;margin-right:8px}.b{width:100%;padding:15px;border:0;border-radius:15px;background:#0a84ff;color:#fff;font-size:17px;font-weight:700;margin-top:16px}.n{font-size:12px;color:#777;line-height:1.6}@media(prefers-color-scheme:dark){body{background:#000;color:#fff}.c{background:#1c1c1e}.i{border-color:#3a3a3c}.sub,.n{color:#aaa}}</style></head><body><div class="w"><div class="c"><h1>⚡ Surge 动态模块中心</h1><p class="sub">选择需要的功能，实时生成一个合集模块，再直接交给 Surge 安装。</p><label class="i"><input type="checkbox" value="bili" checked>📺 BiliBili 净化增强</label><label class="i"><input type="checkbox" value="youtube" checked>▶️ YouTube 净化增强</label><label class="i"><input type="checkbox" value="ximalaya" checked>🎧 喜马拉雅净化增强</label><label class="i"><input type="checkbox" value="startup">🚫 全局开屏去广告增强</label><button class="b" onclick="install()">生成并安装到 Surge</button><p class="n">最终只安装一个「Surge 全功能合集」。MITM 仅合并已选模块需要的 hostname，并使用 %APPEND%，不使用 hostname=*。</p></div></div><script>function install(){const keys=[...document.querySelectorAll('input:checked')].map(x=>x.value);if(!keys.length){alert('至少选择一个模块');return;}const moduleUrl='${origin}/surge-module?modules='+encodeURIComponent(keys.join(','));location.href='surge:///install-module?url='+encodeURIComponent(moduleUrl);}</script></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
