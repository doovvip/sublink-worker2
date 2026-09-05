import { createApp } from './app/createApp.jsx';
import { createCloudflareRuntime } from './runtime/cloudflare.js';
import { handleSurgeModule, handleSurgeModuleCenter } from './surgeModules.js';
import { handlePrivateSurgeDelivery } from './privateSurgeDelivery.js';
import { handleDropboxOAuth } from './dropboxOAuth.js';

let honoApp;

function getApp(env) {
    if (!honoApp) {
        const runtime = createCloudflareRuntime(env);
        honoApp = createApp(runtime);
    }
    return honoApp;
}

export default {
    async fetch(request, env, ctx) {
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

        if (url.pathname === '/surge-nodes') return new Response('Not Found', { status: 404 });
        if (url.pathname === '/surge-modules') return handleSurgeModuleCenter(request);
        if (url.pathname === '/surge-module') return handleSurgeModule(request);
        if (url.pathname === '/dropbox-oauth' || url.pathname === '/dropbox-oauth/callback') return handleDropboxOAuth(request, env);
        if (url.pathname.startsWith('/private/')) return handlePrivateSurgeDelivery(request, env);
        if (url.pathname === '/tanzou' || url.pathname === '/all') {
            return new Response('Not Found', {
                status: 404,
                headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
            });
        }

        return getApp(env).fetch(request, env, ctx);
    }
};
