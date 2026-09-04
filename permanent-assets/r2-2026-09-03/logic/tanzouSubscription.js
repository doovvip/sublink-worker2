function b64decode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function safeName(value, fallback = 'TanZou') {
  try { value = decodeURIComponent(value || ''); } catch {}
  return String(value || fallback).replace(/[\r\n,]/g, ' ').trim() || fallback;
}

function quote(value) {
  const s = String(value ?? '');
  return /[\",]/.test(s) ? `\"${s.replace(/\"/g, '\\\"')}\"` : s;
}

function parseHostPort(server) {
  const m = String(server || '').match(/^\[([^\]]+)\]:(\d+)$|^([^:]+):(\d+)$/);
  if (!m) return null;
  return { host: m[1] || m[3], port: m[2] || m[4] };
}

function normalizeVmessMethod(method) {
  const value = String(method || '').trim().toLowerCase();
  if (!value || value === 'chacha20-poly1305') return 'chacha20-ietf-poly1305';
  return value;
}

function parseSS(uri) {
  try {
    const raw = uri.slice(5);
    const [beforeHash, hash = ''] = raw.split('#');
    let body = beforeHash;
    let plugin = '';
    const q = body.indexOf('?');
    if (q >= 0) { plugin = body.slice(q + 1); body = body.slice(0, q); }

    let method, password, host, port;
    if (body.includes('@')) {
      const at = body.lastIndexOf('@');
      const user = body.slice(0, at);
      const hp = parseHostPort(body.slice(at + 1));
      if (!hp) return null;
      const cred = user.includes(':') ? user : b64decode(user);
      const colon = cred.indexOf(':');
      if (colon < 1) return null;
      method = cred.slice(0, colon);
      password = cred.slice(colon + 1);
      host = hp.host; port = hp.port;
    } else {
      const decoded = b64decode(body);
      const at = decoded.lastIndexOf('@');
      if (at < 1) return null;
      const cred = decoded.slice(0, at);
      const hp = parseHostPort(decoded.slice(at + 1));
      if (!hp) return null;
      const colon = cred.indexOf(':');
      if (colon < 1) return null;
      method = cred.slice(0, colon);
      password = cred.slice(colon + 1);
      host = hp.host; port = hp.port;
    }

    const parts = [`${safeName(hash)} = ss`, host, port, `encrypt-method=${method}`, `password=${quote(password)}`, 'udp-relay=true'];
    if (plugin) {
      const params = new URLSearchParams(plugin);
      const p = params.get('plugin');
      if (p) parts.push(`obfs=${quote(p)}`);
    }
    return parts.join(', ');
  } catch { return null; }
}

function parseTrojan(uri) {
  try {
    const u = new URL(uri);
    const parts = [`${safeName(u.hash.slice(1))} = trojan`, u.hostname, u.port || '443', `password=${quote(decodeURIComponent(u.username))}`];
    const sni = u.searchParams.get('sni') || u.searchParams.get('peer');
    if (sni) parts.push(`sni=${sni}`);
    const allow = u.searchParams.get('allowInsecure') || u.searchParams.get('allow_insecure');
    if (allow === '1' || allow === 'true') parts.push('skip-cert-verify=true');
    parts.push('udp-relay=true');
    return parts.join(', ');
  } catch { return null; }
}

function parseVmess(uri) {
  try {
    let raw = uri.slice(8);
    let fragment = '';
    const hashIndex = raw.indexOf('#');
    if (hashIndex >= 0) {
      fragment = raw.slice(hashIndex + 1);
      raw = raw.slice(0, hashIndex);
    }
    let query = '';
    const queryIndex = raw.indexOf('?');
    if (queryIndex >= 0) {
      query = raw.slice(queryIndex + 1);
      raw = raw.slice(0, queryIndex);
    }

    const decoded = b64decode(raw).trim();
    try {
      const obj = JSON.parse(decoded);
      if (obj.add && obj.port && obj.id) {
        return [
          `${safeName(obj.ps || fragment)} = vmess`,
          obj.add,
          obj.port,
          `username=${obj.id}`,
          'vmess-aead=true',
          'encrypt-method=chacha20-ietf-poly1305'
        ].join(', ');
      }
    } catch {}

    const at = decoded.lastIndexOf('@');
    if (at < 1) return null;
    const credential = decoded.slice(0, at);
    const hp = parseHostPort(decoded.slice(at + 1));
    if (!hp) return null;
    const colon = credential.indexOf(':');
    if (colon < 1) return null;
    const method = normalizeVmessMethod(credential.slice(0, colon));
    const uuid = credential.slice(colon + 1).trim();
    if (!uuid) return null;

    const params = new URLSearchParams(query);
    const name = params.get('remarks') || params.get('remark') || params.get('name') || fragment || 'TanZou';
    return [
      `${safeName(name)} = vmess`,
      hp.host,
      hp.port,
      `username=${uuid}`,
      'vmess-aead=true',
      `encrypt-method=${method}`
    ].join(', ');
  } catch { return null; }
}

function normalizeSubscription(text) {
  let source = String(text || '').trim();
  if (!source.includes('://') && !source.includes(' = ')) {
    try {
      const decoded = b64decode(source).trim();
      if (decoded) source = decoded;
    } catch {}
  }
  return source;
}

function safeFormatDiagnostics(rawText, contentType) {
  const raw = String(rawText || '').trim();
  let b64 = '';
  try { b64 = b64decode(raw).trim(); } catch {}
  return {
    contentType: contentType || '',
    rawLength: raw.length,
    appearsBase64: /^[A-Za-z0-9+/_=\r\n-]+$/.test(raw) && raw.length > 32,
    base64DecodedLength: b64.length,
    decodedLineCount: b64 ? b64.split(/\r?\n/).length : 0,
    vmessCount: (b64.match(/vmess:\/\//gi) || []).length,
    trojanCount: (b64.match(/trojan:\/\//gi) || []).length,
    hasUuidLikeOutsideNodePayload: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(b64)
  };
}

function isUsableSurgeNode(line) {
  const value = String(line || '');
  if (/\b(?:127\.0\.0\.1|0\.0\.0\.0|localhost)\b/i.test(value)) return false;
  if (/防失联|防失聯|tanzfabu\.com/i.test(value)) return false;
  return true;
}

export async function handleTanzouSubscription(request, env = process.env) {
  const url = new URL(request.url);
  const configuredKey = String(env.TANZOU_ACCESS_KEY || '');
  const suppliedKey = String(url.searchParams.get('key') || '');

  if (!configuredKey) return new Response('TANZOU_ACCESS_KEY is not configured', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (suppliedKey !== configuredKey) return new Response('TANZOU_ACCESS_KEY mismatch', { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

  const upstreamUrl = String(env.TANZOU_SUB_URL || '').trim();
  if (!upstreamUrl) return new Response('TANZOU_SUB_URL is not configured', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { 'User-Agent': 'Shadowrocket/2.2.63', 'Accept': 'text/plain,*/*' },
      redirect: 'follow'
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);

    const rawText = await upstream.text();
    if (url.searchParams.get('debug') === 'format') {
      return new Response(JSON.stringify(safeFormatDiagnostics(rawText, upstream.headers.get('content-type')), null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }

    const source = normalizeSubscription(rawText);
    const lines = [];
    const uriNodes = source.match(/(?:vmess|trojan|ss):\/\/[^\s]+/gi) || [];
    for (const node of uriNodes) {
      let converted = null;
      if (/^vmess:\/\//i.test(node)) converted = parseVmess(node);
      else if (/^trojan:\/\//i.test(node)) converted = parseTrojan(node);
      else if (/^ss:\/\//i.test(node)) converted = parseSS(node);
      if (converted) lines.push(converted);
    }

    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (/^[^=]+\s*=\s*(ss|vmess|trojan),/i.test(line)) lines.push(line);
    }

    const unique = [...new Set(lines)].filter(isUsableSurgeNode);
    if (!unique.length) return new Response('No supported TanZou nodes found', { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-TanZou-Nodes': String(unique.length)
    };
    const userInfo = upstream.headers.get('subscription-userinfo');
    if (userInfo) headers['subscription-userinfo'] = userInfo;
    return new Response(`${unique.join('\n')}\n`, { status: 200, headers });
  } catch (error) {
    return new Response(`TanZou conversion failed: ${error?.message || String(error)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
