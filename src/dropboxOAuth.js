const REFRESH_TOKEN_KV_KEY = 'private:dropbox-refresh-token:v1';
const STATE_TTL_MS = 10 * 60 * 1000;
const AAD = new TextEncoder().encode('sublink-worker2/dropbox-refresh-token/v1');

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    }
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function page(title, inner) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0b0d;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",sans-serif}.wrap{max-width:720px;margin:0 auto;padding:40px 20px 72px}.card{background:#171719;border:1px solid #303034;border-radius:22px;padding:24px;box-shadow:0 16px 60px rgba(0,0,0,.28)}h1{font-size:28px;margin:0 0 14px}p{line-height:1.65;color:#c8c8cc}.ok{color:#5ad67d}.warn{color:#ffd666}.bad{color:#ff6b6b}.code{display:block;overflow-wrap:anywhere;background:#0d0d0f;border:1px solid #333;border-radius:12px;padding:12px 14px;color:#e9e9ee;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}.btn{display:block;text-align:center;margin-top:20px;padding:15px 18px;border-radius:14px;background:#0a84ff;color:white;text-decoration:none;font-weight:700}.small{font-size:13px;color:#8e8e93;margin-top:18px}
</style>
</head><body><main class="wrap"><section class="card">${inner}</section></main></body></html>`;
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function oauthEnabled(env) {
  return String(env?.OAUTH_ENABLED || '').trim().toLowerCase() === 'true';
}

function oauthAdminKey(env) {
  return String(env?.OAUTH_ADMIN_KEY || '');
}

function dropboxEncryptionKey(env) {
  return String(env?.DROPBOX_ENCRYPTION_KEY || '');
}



function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text) {
  const normalized = String(text).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(signature));
}



async function aesKey(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptSecret(plaintext, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    await aesKey(secret),
    new TextEncoder().encode(plaintext)
  );
  return JSON.stringify({ v: 1, iv: toBase64Url(iv), data: toBase64Url(new Uint8Array(encrypted)) });
}

async function decryptSecret(payload, secret) {
  const parsed = JSON.parse(String(payload || ''));
  if (parsed?.v !== 1 || !parsed.iv || !parsed.data) throw new Error('Stored Dropbox credential format is invalid');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(parsed.iv), additionalData: AAD },
    await aesKey(secret),
    fromBase64Url(parsed.data)
  );
  return new TextDecoder().decode(decrypted);
}

export async function loadStoredDropboxRefreshToken(env) {
  if (!env?.SUBLINK_KV || typeof env.SUBLINK_KV.get !== 'function') return '';
  const stored = await env.SUBLINK_KV.get(REFRESH_TOKEN_KV_KEY);
  if (!stored) return '';
  const encryptionKey = dropboxEncryptionKey(env);
  if (!encryptionKey) return '';
  return decryptSecret(stored, encryptionKey);
}

async function saveStoredDropboxRefreshToken(env, refreshToken) {
  if (!env?.SUBLINK_KV || typeof env.SUBLINK_KV.put !== 'function') {
    throw new Error('SUBLINK_KV is not configured');
  }
  const encryptionKey = dropboxEncryptionKey(env);
  if (!encryptionKey) throw new Error('DROPBOX_ENCRYPTION_KEY is not configured');
  const encrypted = await encryptSecret(refreshToken, encryptionKey);
  await env.SUBLINK_KV.put(REFRESH_TOKEN_KV_KEY, encrypted);
}

function callbackUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/dropbox-oauth/callback`;
}

function safeDropboxOAuthError(text) {
  const known = new Set([
    'invalid_request',
    'invalid_client',
    'invalid_grant',
    'unauthorized_client',
    'unsupported_grant_type',
    'invalid_scope',
    'redirect_uri_mismatch'
  ]);
  try {
    const parsed = JSON.parse(String(text || ''));
    const code = String(parsed?.error || '').trim();
    const description = String(parsed?.error_description || '').trim();
    if (known.has(code)) return description ? `${code}: ${description.slice(0, 180)}` : code;
  } catch {}
  const lower = String(text || '').toLowerCase();
  for (const code of known) {
    if (lower.includes(code)) return code;
  }
  return 'unknown_oauth_error';
}

async function exchangeAuthorizationCode(request, env, code, codeVerifier) {
  const appKey = String(env.DROPBOX_APP_KEY || '');
  if (!appKey || !codeVerifier) throw new Error('Dropbox PKCE credentials are not configured');
  const body = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    client_id: appKey,
    code_verifier: codeVerifier,
    redirect_uri: callbackUrl(request)
  });
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Dropbox OAuth token exchange failed (${response.status}): ${safeDropboxOAuthError(responseText)}`);
  let data;
  try { data = JSON.parse(responseText); } catch { throw new Error('Dropbox OAuth returned invalid JSON'); }
  if (!data?.refresh_token) throw new Error('Dropbox did not return a refresh token');
  return data;
}

async function validateRefreshToken(env, refreshToken) {
  const accessToken = await requestRefreshAccessToken(env, refreshToken);
  const r2Path = String(env.DROPBOX_R2_PATH || '');
  if (!r2Path) return;
  const download = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': JSON.stringify({ path: r2Path }).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
    }
  });
  if (!download.ok) throw new Error(`Dropbox R2 validation failed (${download.status})`);
}

async function createPkceState(secret, codeVerifier) {
  const ts = Date.now().toString(36);
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(18)));
  const encryptedVerifier = await encryptSecret(codeVerifier, secret);
  const packedVerifier = toBase64Url(new TextEncoder().encode(encryptedVerifier));
  const payload = `${ts}.${nonce}.${packedVerifier}`;
  return `${payload}.${await hmac(secret, payload)}`;
}

async function readPkceVerifierFromState(secret, state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4) return '';
  const [ts, nonce, packedVerifier, signature] = parts;
  if (!ts || !nonce || !packedVerifier || !signature) return '';
  const issuedAt = parseInt(ts, 36);
  if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > STATE_TTL_MS) return '';
  const payload = `${ts}.${nonce}.${packedVerifier}`;
  const expected = await hmac(secret, payload);
  if (!constantTimeEqual(expected, signature)) return '';
  try {
    const encryptedVerifier = new TextDecoder().decode(fromBase64Url(packedVerifier));
    return await decryptSecret(encryptedVerifier, secret);
  } catch {
    return '';
  }
}

function createPkceVerifier() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(48)));
}

async function createPkceChallenge(codeVerifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return toBase64Url(new Uint8Array(digest));
}

async function requestRefreshAccessToken(env, refreshToken) {
  const appKey = String(env.DROPBOX_APP_KEY || '');
  if (!refreshToken || !appKey) throw new Error('Dropbox refresh credentials are not configured');

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: String(refreshToken),
      grant_type: 'refresh_token',
      client_id: appKey
    })
  });
  if (!response.ok) throw new Error(`Dropbox refresh-token validation failed (${response.status})`);
  const data = await response.json();
  if (!data?.access_token) throw new Error('Dropbox refresh-token validation returned no access token');
  return String(data.access_token);
}




async function renderStart(request, env) {
  if (!oauthEnabled(env)) {
    return htmlResponse(page('Not Found', '<h1>404</h1><p>Not Found</p>'), 404);
  }

  const url = new URL(request.url);
  const adminKey = oauthAdminKey(env);
  const suppliedKey = String(url.searchParams.get('key') || '');
  if (!adminKey || !suppliedKey || !constantTimeEqual(adminKey, suppliedKey)) {
    return htmlResponse(page('Not Found', '<h1>404</h1><p>Not Found</p>'), 404);
  }
  if (!env.DROPBOX_APP_KEY) {
    return htmlResponse(page('Dropbox OAuth', '<h1>Dropbox 授权暂不可用</h1><p class="bad">App Key 尚未配置。</p>'), 503);
  }
  if (!env.SUBLINK_KV) {
    return htmlResponse(page('Dropbox OAuth', '<h1>Dropbox 授权暂不可用</h1><p class="bad">SUBLINK_KV 尚未配置。</p>'), 503);
  }

  const redirect = callbackUrl(request);
  const codeVerifier = createPkceVerifier();
  const state = await createPkceState(adminKey, codeVerifier);
  const codeChallenge = await createPkceChallenge(codeVerifier);
  const auth = new URL('https://www.dropbox.com/oauth2/authorize');
  auth.searchParams.set('client_id', String(env.DROPBOX_APP_KEY));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('token_access_type', 'offline');
  auth.searchParams.set('redirect_uri', redirect);
  auth.searchParams.set('state', state);
  auth.searchParams.set('force_reapprove', 'true');
  auth.searchParams.set('code_challenge_method', 'S256');
  auth.searchParams.set('code_challenge', codeChallenge);

  let alreadyStored = false;
  try { alreadyStored = Boolean(await loadStoredDropboxRefreshToken(env)); } catch { alreadyStored = false; }

  return htmlResponse(page('Dropbox 长期授权', `
    <h1>Dropbox 长期授权</h1>
    <p>${alreadyStored ? '<span class="ok">检测到已保存的长期授权，可重新授权覆盖。</span>' : '<span class="warn">当前还没有长期 Refresh Token。</span>'}</p>
    <p>确认 Dropbox App 的 OAuth Redirect URI 已包含：</p>
    <span class="code">${escapeHtml(redirect)}</span>
    <p>点击下面按钮。当前使用 <b>PKCE + offline</b> 授权；完成后 Refresh Token 会直接加密写入 Cloudflare KV。</p>
    <a class="btn" href="${escapeHtml(auth.toString())}">授权 Dropbox</a>
    <p class="small">授权完成后无需复制任何 Token。</p>
  `));
}

async function renderCallback(request, env) {
  if (!oauthEnabled(env)) {
    return htmlResponse(page('Not Found', '<h1>404</h1><p>Not Found</p>'), 404);
  }

  const url = new URL(request.url);
  const adminKey = oauthAdminKey(env);
  const codeVerifier = adminKey ? await readPkceVerifierFromState(adminKey, url.searchParams.get('state')) : '';
  if (!adminKey || !codeVerifier) {
    return htmlResponse(page('授权失败', '<h1>授权失败</h1><p class="bad">OAuth state 无效或已过期，请从授权页面重新开始。</p>'), 400);
  }
  if (url.searchParams.get('error')) {
    return htmlResponse(page('授权取消', `<h1>授权未完成</h1><p class="warn">Dropbox 返回：${escapeHtml(url.searchParams.get('error_description') || url.searchParams.get('error'))}</p>`), 400);
  }
  const code = String(url.searchParams.get('code') || '');
  if (!code) return htmlResponse(page('授权失败', '<h1>授权失败</h1><p class="bad">Dropbox 没有返回 authorization code。</p>'), 400);

  try {
    const tokenData = await exchangeAuthorizationCode(request, env, code, codeVerifier);
    await validateRefreshToken(env, tokenData.refresh_token);
    await saveStoredDropboxRefreshToken(env, tokenData.refresh_token);
    return htmlResponse(page('授权成功', `
      <h1>✅ Dropbox 长期授权成功</h1>
      <p class="ok">Refresh Token 已验证，并使用 AES-GCM 加密保存到 Cloudflare KV。</p>
      <p>本次 OAuth 使用 PKCE，不依赖 App Secret；Token 不会显示在页面。</p>
      <p><b>下一步：</b>回到聊天告诉我“授权成功”。</p>
    `));
  } catch (error) {
    return htmlResponse(page('授权失败', `<h1>授权失败</h1><p class="bad">${escapeHtml(error?.message || String(error))}</p><p>请返回授权页重试。</p>`), 502);
  }
}

export async function handleDropboxOAuth(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/dropbox-oauth/callback') return renderCallback(request, env);
  if (url.pathname === '/dropbox-oauth') return renderStart(request, env);
  return htmlResponse(page('Not Found', '<h1>404</h1>'), 404);
}