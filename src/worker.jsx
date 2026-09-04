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
    return String(name || 'Node').replace(/[\r\n]/g, ' ').replace(/,/g, '，').trim();
}
function quoteIfNeeded(value) { const text=String(value??''); return /[",]/.test(text)?`"${text.replace(/"/g,'\\"')}"`:text; }
function clashProxyToSurge(proxy) {
    if (!proxy || typeof proxy !== 'object' || !proxy.server || proxy.port == null) return null;
    const server=String(proxy.server).trim(); if(!server||server==='127.0.0.1'||server==='localhost')return null;
    const name=sanitizeName(proxy.name),port=proxy.port,type=String(proxy.type||'').toLowerCase();
    if(type==='vmess'){if(!proxy.uuid)return null;const p=[`${name} = vmess`,server,port,`username=${proxy.uuid}`];const a=proxy.alterId??proxy['alter-id']??proxy.alter_id;if(a==null||Number(a)===0)p.push('vmess-aead=true');if(proxy.udp===true)p.push('udp-relay=true');if(proxy.tls===true)p.push('tls=true');const s=proxy.servername||proxy.sni;if(s)p.push(`sni=${s}`);if(proxy['skip-cert-verify']===true)p.push('skip-cert-verify=true');const n=String(proxy.network||'').toLowerCase();if(n==='ws'){p.push('ws=true');const w=proxy['ws-opts']||proxy.ws_opts||{};if(w.path)p.push(`ws-path=${quoteIfNeeded(w.path)}`);const h=w.headers?.Host||w.headers?.host;if(h)p.push(`ws-headers=Host:${h}`)}return p.join(', ')}
    if(type==='ss'||type==='shadowsocks'){const c=proxy.cipher||proxy.method;if(!c||proxy.password==null)return null;const p=[`${name} = ss`,server,port,`encrypt-method=${c}`,`password=${quoteIfNeeded(proxy.password)}`];if(proxy.udp===true)p.push('udp-relay=true');return p.join(', ')}
    if(type==='trojan'){if(proxy.password==null)return null;const p=[`${name} = trojan`,server,port,`password=${quoteIfNeeded(proxy.password)}`];const s=proxy.sni||proxy.servername;if(s)p.push(`sni=${s}`);if(proxy['skip-cert-verify']===true)p.push('skip-cert-verify=true');if(proxy.udp===true)p.push('udp-relay=true');return p.join(', ')}
    return null;
}
async function handleSurgeNodes(request){const requestUrl=new URL(request.url);const sourceUrl=requestUrl.searchParams.get('config')||requestUrl.searchParams.get('url');if(!sourceUrl)return new Response('Missing config parameter',{status:400,headers:{'Content-Type':'text/plain; charset=utf-8'}});let parsed;try{parsed=new URL(sourceUrl);if(!['http:','https:'].includes(parsed.protocol))throw new Error()}catch{return new Response('Invalid config URL',{status:400,headers:{'Content-Type':'text/plain; charset=utf-8'}})}try{const ua=requestUrl.searchParams.get('ua')||'Clash/1.18.0';const upstream=await fetch(parsed.toString(),{headers:{'User-Agent':ua,'Accept':'text/yaml,text/plain,*/*'}});if(!upstream.ok)return new Response(`Upstream error: ${upstream.status}`,{status:502,headers:{'Content-Type':'text/plain; charset=utf-8'}});const data=parseYaml(await upstream.text());const proxies=Array.isArray(data?.proxies)?data.proxies:null;if(!proxies)return new Response('No proxies array found in Clash YAML',{status:422,headers:{'Content-Type':'text/plain; charset=utf-8'}});const lines=proxies.map(clashProxyToSurge).filter(Boolean);if(!lines.length)return new Response('No supported proxy nodes found',{status:422,headers:{'Content-Type':'text/plain; charset=utf-8'}});const headers={'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'};const ui=upstream.headers.get('subscription-userinfo');if(ui)headers['subscription-userinfo']=ui;return new Response(`${lines.join('\n')}\n`,{status:200,headers})}catch(e){return new Response(`Surge node conversion failed: ${e?.message||String(e)}`,{status:500,headers:{'Content-Type':'text/plain; charset=utf-8'}})}}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (url.pathname === '/health') return new Response('OK',{status:200,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
        if (url.pathname === '/surge-nodes') return handleSurgeNodes(request);
        if (url.pathname === '/surge-modules') return handleSurgeModuleCenter(request);
        if (url.pathname === '/surge-module') return handleSurgeModule(request);
        return getApp(env).fetch(request,env,ctx);
    }
};
