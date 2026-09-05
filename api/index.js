import { createRequire } from 'module';
import { Readable } from 'stream';
import { createVercelRuntime } from '../src/runtime/vercel.js';
import { handleSurgeModule, handleSurgeModuleCenter } from '../src/surgeModules.js';
import 'hono/jsx/jsx-runtime';

const runtime = createVercelRuntime(process.env);
const appPromise = loadCreateApp().then((createApp) => createApp(runtime));

async function loadCreateApp() {
    try {
        const mod = await import('../dist/vercel/createApp.js');
        if (!mod?.createApp) {
            throw new Error('Compiled Vercel bundle is missing createApp export');
        }
        return mod.createApp;
    } catch (error) {
        if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
            throw error;
        }
    }

    const { register } = await import('esbuild-register/dist/node');
    register({
        extensions: ['.ts', '.tsx', '.jsx'],
        jsx: 'automatic',
        target: 'es2020'
    });

    const require = createRequire(import.meta.url);
    const { createApp } = require('../src/app/createApp.jsx');
    return createApp;
}

export const config = {
    runtime: 'nodejs'
};

export default async function handler(req, res) {
    try {
        const request = await toRequest(req);
        const url = new URL(request.url);

        let response;
        if (url.pathname === '/health') {
            response = new Response('OK', {
                status: 200,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            });
        } else if (url.pathname === '/surge-modules') {
            response = handleSurgeModuleCenter(request);
        } else if (url.pathname === '/surge-module') {
            response = await handleSurgeModule(request);
        } else if (url.pathname === '/tanzou' || url.pathname === '/all') {
            response = new Response('Not Found', {
                status: 404,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store'
                }
            });
        } else {
            const app = await appPromise;
            response = await app.fetch(request);
        }

        await sendResponse(res, response);
    } catch (error) {
        console.error('Vercel handler error', error);
        if (!res.headersSent) {
            res.statusCode = 500;
        }
        res.end('Internal Server Error');
    }
}

async function toRequest(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host || 'localhost';
    const url = `${protocol}://${host}${req.url}`;
    const method = req.method || 'GET';
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers || {})) {
        if (Array.isArray(value)) {
            for (const item of value) headers.append(key, item);
        } else if (value != null) {
            headers.set(key, String(value));
        }
    }

    const init = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(req);
        init.duplex = 'half';
    }

    return new Request(url, init);
}

async function sendResponse(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (!response.body) {
        res.end();
        return;
    }

    const reader = response.body.getReader();
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    res.end();
}
