import { loadStoredDropboxRefreshToken } from './dropboxOAuth.js';

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'Cache-Control': 'no-store',
  'Pragma': 'no-cache'
};

function textResponse(body, status = 200) {
  return new Response(body, { status, headers: TEXT_HEADERS });
}

function constantTimeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function dropboxHeaderJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

async function refreshDropboxAccessToken(env, refreshToken) {
  const appKey = String(env.DROPBOX_APP_KEY || '');
  if (!refreshToken || !appKey) throw new Error('Dropbox refresh credentials are not configured');

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(refreshToken),
      client_id: appKey
    })
  });
  if (!response.ok) throw new Error(`Dropbox token refresh failed (${response.status})`);
  const data = await response.json();
  if (!data?.access_token) throw new Error('Dropbox token refresh returned no access token');
  return String(data.access_token);
}

async function getDropboxAccessToken(env) {
  const appKey = String(env.DROPBOX_APP_KEY || '');
  if (!appKey) throw new Error('Dropbox App Key is not configured');

  const storedRefresh = await loadStoredDropboxRefreshToken(env);
  if (storedRefresh) return refreshDropboxAccessToken(env, storedRefresh);

  throw new Error('Dropbox long-lived refresh credential is not configured');
}

async function downloadDropboxText(path, accessToken) {
  const response = await fetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Dropbox-API-Arg': dropboxHeaderJson({ path })
    }
  });

  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).trim().slice(0, 300); } catch {}
    throw new Error(`Dropbox download failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  return response.text();
}


function privateUrl(request, pathname, authParam, authValue) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.search = '';
  url.searchParams.set(authParam, authValue);
  return url.toString();
}

function rewriteManagedProfile(text, request, authParam, authValue, pathname) {
  const managedUrl = privateUrl(request, pathname, authParam, authValue);
  const tanzouUrl = privateUrl(request, '/private/TanZou.list', authParam, authValue);
  let output = String(text || '');
  const managedLine = `#!MANAGED-CONFIG ${managedUrl} interval=86400 strict=false`;
  if (/^#!MANAGED-CONFIG[^\r\n]*/m.test(output)) output = output.replace(/^#!MANAGED-CONFIG[^\r\n]*/m, managedLine);
  else output = `${managedLine}\n${output}`;

  output = output.replace(
    /^(✈️ 我的节点\s*=\s*select,\s*policy-path=)[^,\r\n]+/m,
    `$1${tanzouUrl}`
  );
  return output;
}


const TARGETS = {
  '/private/r2': { envPath: 'DROPBOX_R2_PATH', managed: true },
  '/private/R2.conf': { envPath: 'DROPBOX_R2_PATH', managed: true },
  '/private/Surge-R2.conf': { envPath: 'DROPBOX_R2_PATH', managed: true },
  '/private/tanzou': { envPath: 'DROPBOX_TANZOU_PATH', managed: false },
  '/private/TanZou.list': { envPath: 'DROPBOX_TANZOU_PATH', managed: false }
};

export async function handlePrivateSurgeDelivery(request, env) {
  const url = new URL(request.url);
  const target = TARGETS[url.pathname];
  if (!target) return textResponse('Not Found', 404);

  const configuredR2Token = String(env.R2_DELIVERY_TOKEN || '');
  const suppliedToken = String(url.searchParams.get('token') || '');

  if (!suppliedToken) return textResponse('Not Found', 404);
  if (!configuredR2Token) return textResponse('Private delivery is not configured', 503);
  if (!constantTimeEqual(configuredR2Token, suppliedToken)) return textResponse('Not Found', 404);

  const authParam = 'token';
  const authValue = suppliedToken;

  const dropboxPath = String(env[target.envPath] || '');
  if (!dropboxPath) return textResponse('Private delivery source is not configured', 503);

  try {
    const accessToken = await getDropboxAccessToken(env);
    let content = await downloadDropboxText(dropboxPath, accessToken);


    if (target.managed) {
      content = rewriteManagedProfile(content, request, authParam, authValue, url.pathname);
    }
    return textResponse(content, 200);
  } catch (error) {
    return textResponse(`Private delivery failed: ${error?.message || String(error)}`, 502);
  }
}
