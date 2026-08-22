import { load as parseYaml } from 'js-yaml';
import { createApp } from './app/createApp.jsx';
import { createCloudflareRuntime } from './runtime/cloudflare.js';
import { handleSurgeModule, handleSurgeModuleCenter } from './surgeModules.js';

let honoApp;

function getApp(env) {
    if (!honoApp) {
        const runtime = createCloudflareRuntime(env);
        honoApp = createApp(runtime);
    }
    return honoApp;
}

function sanitizeName(name) {
    return String(name || 'Node')
        .replace(/[\r\n]/g, ' ')
        .replace(/,/g, '，')
        .trim();
}

function quoteIfNeeded(value) {
    const text = String(value ?? '');
    if (!/[",]/.test(text)) return text;
    return `\"${text.replace(/\"/g, '\\\"')}\"`;
}

function clashProxyToSurge(proxy) {
    if (!proxy || typeof proxy !== 'object') return null;
    if (!proxy.server || proxy.port == null) return null;

    const server = String(proxy.server).trim();
    if (!server || server === '127.0.0.1' || server === 'localhost') return null;

    const name = sanitizeName(proxy.name);
    const port = proxy.port;
    const type = String(proxy.type || '').toLowerCase();

    if (type === 'vmess') {
        if (!proxy.uuid) return null;
        const parts = [
            `${name} = vmess`,
            server,
            port,
            `username=${proxy.uuid}`
        ];

        const alterId = proxy.alterId ?? proxy['alter-id'] ?? proxy.alter_id;
        if (alterId == null || Number(alterId) === 0) parts.push('vmess-aead=true');

        if (proxy.udp === true) parts.push('udp-relay=true');
        if (proxy.tls === true) parts.push('tls=true');

        const sni = proxy.servername || proxy.sni;
        if (sni) parts.push(`sni=${sni}`);
        if (proxy['skip-cert-verify'] === true) parts.push('skip-cert-verify=true');

        const network = String(proxy.network || '').toLowerCase();
        if (network === 'ws') {
            parts.push('ws=true');
            const wsOpts = proxy['ws-opts'] || proxy.ws_opts || {};
            if (wsOpts.path) parts.push(`ws-path=${quoteIfNeeded(wsOpts.path)}`);
            const host = wsOpts.headers?.Host || wsOpts.headers?.host;
            if (host) parts.push(`ws-headers=Host:${host}`);
        }

        return parts.join(', ');
    }

    if (type === 'ss' || type === 'shadowsocks') {
        const cipher = proxy.cipher || proxy.method;
        if (!cipher || proxy.password == null) return null;
        const parts = [
            `${name} = ss`,
            server,
            port,
            `encrypt-method=${cipher}`,
            `password=${quoteIfNeeded(proxy.password)}`
        ];
        if (proxy.udp === true) parts.push('udp-relay=true');
        return parts.join(', ');
    }

    if (type === 'trojan') {
        if (proxy.password == null) return null;
        const parts = [
            `${name} = trojan`,
            server,
            port,
            `password=${quoteIfNeeded(proxy.password)}`
        ];
        const sni = proxy.sni || proxy.servername;
        if (sni) parts.push(`sni=${sni}`);
        if (proxy['skip-cert-verify'] === true) parts.push('skip-cert-verify=true');
        if (proxy.udp === true) parts.push('udp-relay=true');
        return parts.join(', ');
    }

    return null;
}

async function handleSurgeNodes(request) {
    const requestUrl = new URL(request.url);
    const sourceUrl = requestUrl.searchParams.get('config') || requestUrl.searchParams.get('url');

    if (!sourceUrl) {
        return new Response('Missing config parameter', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }

    let parsedSourceUrl;
    try {
        parsedSourceUrl = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(parsedSourceUrl.protocol)) throw new Error('Unsupported protocol');
    } catch {
        return new Response('Invalid config URL', {
            status: 400,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }

    try {
        const ua = requestUrl.searchParams.get('ua') || 'Clash/1.18.0';
        const upstream = await fetch(parsedSourceUrl.toString(), {
            headers: {
                'User-Agent': ua,
                'Accept': 'text/yaml,text/plain,*/*'
            }
        });

        if (!upstream.ok) {
            return new Response(`Upstream error: ${upstream.status}`, {
                status: 502,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        const text = await upstream.text();
        const data = parseYaml(text);
        const proxies = Array.isArray(data?.proxies) ? data.proxies : null;

        if (!proxies) {
            return new Response('No proxies array found in Clash YAML', {
                status: 422,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        const lines = proxies.map(clashProxyToSurge).filter(Boolean);
        if (lines.length === 0) {
            return new Response('No supported proxy nodes found', {
                status: 422,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
        }

        const headers = {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store'
        };
        const userInfo = upstream.headers.get('subscription-userinfo');
        if (userInfo) headers['subscription-userinfo'] = userInfo;

        return new Response(`${lines.join('\n')}\n`, { status: 200, headers });
    } catch (error) {
        return new Response(`Surge node conversion failed: ${error?.message || String(error)}`, {
            status: 500,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
    }
}

export default {
    fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return new Response('OK', {
                status: 200,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            });
        }

        if (url.pathname === '/surge-nodes') {
            return handleSurgeNodes(request);
        }

        if (url.pathname === '/surge-modules') {
            return handleSurgeModuleCenter(request);
        }

        if (url.pathname === '/surge-module') {
            return handleSurgeModule(request);
        }

        const app = getApp(env);
        return app.fetch(request, env, ctx);
    }
};
