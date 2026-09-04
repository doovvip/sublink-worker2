import { handleTanzouSubscription } from './tanzouSubscription.js';

function b64decode(input) {
  const normalized = String(input || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function safeName(value, fallback = 'Node') {
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

function normalizeSource(text) {
  let source = String(text || '').trim();
  if (!source.includes('://') && !source.includes(' = ')) {
    try {
      const decoded = b64decode(source).trim();
      if (decoded) source = decoded;
    } catch {}
  }
  return source;
}

function boolish(value) {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'tls' || v === 'yes';
}

function normalizeVmessCipher(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'chacha20-poly1305') return 'chacha20-ietf-poly1305';
  if (v === 'chacha20-ietf-poly1305' || v === 'aes-128-gcm') return v;
  return '';
}

function appendWsTls(parts, options = {}) {
  const ws = !!options.ws;
  const tls = !!options.tls;
  if (ws) {
    parts.push('ws=true');
    const path = String(options.path || '/').trim() || '/';
    parts.push(`ws-path=${path.startsWith('/') ? path : `/${path}`}`);
    if (options.host) parts.push(`ws-headers=Host:${String(options.host).trim()}`);
  }
  if (tls) {
    parts.push('tls=true');
    if (options.sni) parts.push(`sni=${String(options.sni).trim()}`);
    if (options.skipCertVerify) parts.push('skip-cert-verify=true');
  }
}

// Generic VMess parser retained for Airport C compatibility.
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
        return [`${safeName(obj.ps || fragment)} = vmess`, obj.add, obj.port, `username=${obj.id}`, 'vmess-aead=true', 'encrypt-method=chacha20-ietf-poly1305'].join(', ');
      }
    } catch {}

    const at = decoded.lastIndexOf('@');
    if (at < 1) return null;
    const credential = decoded.slice(0, at);
    const hp = parseHostPort(decoded.slice(at + 1));
    if (!hp) return null;
    const colon = credential.indexOf(':');
    if (colon < 1) return null;
    let method = credential.slice(0, colon).trim().toLowerCase();
    if (!method || method === 'chacha20-poly1305') method = 'chacha20-ietf-poly1305';
    const uuid = credential.slice(colon + 1).trim();
    if (!uuid) return null;
    const params = new URLSearchParams(query);
    const name = params.get('remarks') || params.get('remark') || params.get('name') || fragment || 'Node';
    return [`${safeName(name)} = vmess`, hp.host, hp.port, `username=${uuid}`, 'vmess-aead=true', `encrypt-method=${method}`].join(', ');
  } catch { return null; }
}

// Airport B has a mix of legacy and AEAD VMess plus WS/TLS nodes.
// Preserve the source alterId/transport fields instead of forcing AEAD=true.
function parseVmessB(uri) {
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
        const aid = Number.parseInt(String(obj.aid ?? obj.alterId ?? '0'), 10);
        const isAead = !Number.isFinite(aid) || aid === 0;
        const parts = [
          `${safeName(obj.ps || fragment)} = vmess`,
          obj.add,
          obj.port,
          `username=${obj.id}`,
          `vmess-aead=${isAead ? 'true' : 'false'}`
        ];
        const cipher = normalizeVmessCipher(obj.scy || obj.cipher);
        if (cipher) parts.push(`encrypt-method=${cipher}`);

        const net = String(obj.net || obj.network || '').toLowerCase();
        const tls = boolish(obj.tls) || String(obj.security || '').toLowerCase() === 'tls';
        appendWsTls(parts, {
          ws: net === 'ws' || net === 'websocket',
          tls,
          path: obj.path,
          host: obj.host,
          sni: obj.sni || obj.serverName,
          skipCertVerify: boolish(obj.allowInsecure) || boolish(obj.skipCertVerify)
        });
        return parts.join(', ');
      }
    } catch {}

    const at = decoded.lastIndexOf('@');
    if (at < 1) return null;
    const credential = decoded.slice(0, at);
    const hp = parseHostPort(decoded.slice(at + 1));
    if (!hp) return null;
    const colon = credential.indexOf(':');
    if (colon < 1) return null;
    const rawMethod = credential.slice(0, colon).trim();
    const uuid = credential.slice(colon + 1).trim();
    if (!uuid) return null;

    const params = new URLSearchParams(query);
    const name = params.get('remarks') || params.get('remark') || params.get('name') || fragment || 'Node';
    const aid = Number.parseInt(params.get('alterId') || params.get('aid') || '0', 10);
    const isAead = !Number.isFinite(aid) || aid === 0;
    const parts = [
      `${safeName(name)} = vmess`, hp.host, hp.port,
      `username=${uuid}`,
      `vmess-aead=${isAead ? 'true' : 'false'}`
    ];
    const cipher = normalizeVmessCipher(params.get('scy') || params.get('cipher') || rawMethod);
    if (cipher) parts.push(`encrypt-method=${cipher}`);

    const obfs = String(params.get('obfs') || params.get('net') || params.get('network') || '').toLowerCase();
    appendWsTls(parts, {
      ws: obfs === 'websocket' || obfs === 'ws',
      tls: boolish(params.get('tls')) || String(params.get('security') || '').toLowerCase() === 'tls',
      path: params.get('path') || params.get('wsPath'),
      host: params.get('obfsParam') || params.get('host'),
      sni: params.get('peer') || params.get('sni') || params.get('serverName'),
      skipCertVerify: boolish(params.get('allowInsecure')) || boolish(params.get('skip-cert-verify'))
    });
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
    const type = String(u.searchParams.get('type') || u.searchParams.get('network') || '').toLowerCase();
    if (type === 'ws' || type === 'websocket') {
      parts.push('ws=true');
      const path = u.searchParams.get('path') || '/';
      parts.push(`ws-path=${path.startsWith('/') ? path : `/${path}`}`);
      const host = u.searchParams.get('host');
      if (host) parts.push(`ws-headers=Host:${host}`);
    }
    parts.push('udp-relay=true');
    return parts.join(', ');
  } catch { return null; }
}

function parseSS(uri) {
  try {
    const raw = uri.slice(5);
    const [beforeHash, hash = ''] = raw.split('#');
    let body = beforeHash;
    const q = body.indexOf('?');
    if (q >= 0) body = body.slice(0, q);
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
    return [`${safeName(hash)} = ss`, host, port, `encrypt-method=${method}`, `password=${quote(password)}`, 'udp-relay=true'].join(', ');
  } catch { return null; }
}

function convertGeneric(text) {
  const source = normalizeSource(text);
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^[^=]+\s*=\s*(ss|vmess|trojan|http|https|socks5),/i.test(line)) lines.push(line);
  }
  const uriNodes = source.match(/(?:vmess|trojan|ss):\/\/[^\s]+/gi) || [];
  for (const node of uriNodes) {
    let converted = null;
    if (/^vmess:\/\//i.test(node)) converted = parseVmess(node);
    else if (/^trojan:\/\//i.test(node)) converted = parseTrojan(node);
    else if (/^ss:\/\//i.test(node)) converted = parseSS(node);
    if (converted) lines.push(converted);
  }
  return [...new Set(lines)];
}

function convertAirportB(text) {
  const source = normalizeSource(text);
  const lines = [];
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^[^=]+\s*=\s*(ss|vmess|trojan|http|https|socks5),/i.test(line)) lines.push(line);
  }
  const uriNodes = source.match(/(?:vmess|trojan|ss):\/\/[^\s]+/gi) || [];
  for (const node of uriNodes) {
    let converted = null;
    if (/^vmess:\/\//i.test(node)) converted = parseVmessB(node);
    else if (/^trojan:\/\//i.test(node)) converted = parseTrojan(node);
    else if (/^ss:\/\//i.test(node)) converted = parseSS(node);
    if (converted) lines.push(converted);
  }
  return [...new Set(lines)];
}

function addPrefix(lines, prefix) {
  return lines.map((line) => line.replace(/^\s*([^=]+?)\s*=\s*/, (_, name) => `${prefix} ${name.trim()} = `));
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Surge/5.20', 'Accept': 'text/plain,*/*' },
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return { text: await response.text(), userInfo: response.headers.get('subscription-userinfo') || '' };
}

export async function handleUnifiedSubscription(request, env = process.env) {
  const url = new URL(request.url);
  const configuredKey = String(env.TANZOU_ACCESS_KEY || '');
  const suppliedKey = String(url.searchParams.get('key') || '');
  if (!configuredKey) return new Response('ACCESS_KEY is not configured', { status: 503 });
  if (suppliedKey !== configuredKey) return new Response('ACCESS_KEY mismatch', { status: 401 });

  const bUrl = String(env.AIRPORT_B_SUB_URL || '').trim();
  const cUrl = String(env.AIRPORT_C_SUB_URL || '').trim();
  if (!bUrl || !cUrl) {
    return new Response('AIRPORT_B_SUB_URL / AIRPORT_C_SUB_URL is not configured', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  try {
    const tanzouRequest = new Request(`${url.origin}/tanzou?key=${encodeURIComponent(configuredKey)}`);
    const [aResponse, bSource, cSource] = await Promise.all([
      handleTanzouSubscription(tanzouRequest, env),
      fetchText(bUrl),
      fetchText(cUrl)
    ]);
    if (!aResponse.ok) throw new Error(`TanZou ${aResponse.status}`);

    const aLines = addPrefix((await aResponse.text()).split(/\r?\n/).map((x) => x.trim()).filter(Boolean), 'A');
    const bLines = addPrefix(convertAirportB(bSource.text), 'B');
    const cLines = addPrefix(convertGeneric(cSource.text), 'C');
    if (!aLines.length || !bLines.length || !cLines.length) {
      throw new Error(`node parse failed A=${aLines.length} B=${bLines.length} C=${cLines.length}`);
    }

    const all = [...aLines, ...bLines, ...cLines];
    const headers = {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Airport-A-Nodes': String(aLines.length),
      'X-Airport-B-Nodes': String(bLines.length),
      'X-Airport-C-Nodes': String(cLines.length),
      'X-Airport-Total-Nodes': String(all.length)
    };
    const aUserInfo = aResponse.headers.get('subscription-userinfo');
    if (aUserInfo) headers['subscription-userinfo'] = aUserInfo;
    return new Response(`${all.join('\n')}\n`, { status: 200, headers });
  } catch (error) {
    return new Response(`Unified subscription failed: ${error?.message || String(error)}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
}
