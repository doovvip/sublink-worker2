// Taobao price web endpoint build trigger 2026-08-29 00:38
import { createRequire } from 'module';
import { Readable } from 'stream';
import { createVercelRuntime } from '../src/runtime/vercel.js';
import { handleSurgeModule, handleSurgeModuleCenter } from '../src/surgeModules.js';
import { handleTanzouSubscription } from '../src/tanzouSubscription.js';
import { handleUnifiedSubscription } from '../src/unifiedSubscription.js';
import { handleTaobaoPricePage } from '../src/taobaoPriceWeb.js';
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
        } else if (url.pathname === '/taobao-price' || url.pathname === '/api/taobao-price') {
            response = await handleTaobaoPricePage(request);
        } else if (url.pathname === '/surge-modules') {
            response = handleSurgeModuleCenter(request);
        } else if (url.pathname === '/surge-module') {
            response = await handleSurgeModule(request);
        } else if (url.pathname === '/tanzou') {
            response = await handleTanzouSubscription(request, process.env);
        } else if (url.pathname === '/all') {
            response = await handleUnifiedSubscription(request, process.env);
            if (response.ok) {
                response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
            }
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

const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'content-length'
]);

const MAX_BODY_BYTES = 5 * 1024 * 1024;

async function toRequest(req) {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const url = `${protocol}://${host}${req.url ?? ''}`;
    const method = req.method || 'GET';
    const headers = new Headers();

    for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) continue;
        if (Array.isArray(value)) {
            for (const entry of value) {
                headers.append(key, entry);
            }
        } else {
            headers.set(key, value);
        }
    }

    if (method === 'GET' || method === 'HEAD') {
        return new Request(url, { method, headers });
    }

    const body = await resolveBody(req);
    return new Request(url, {
        method,
        headers,
        body
    });
}

async function resolveBody(req) {
    if (req.body !== undefined) {
        return normalizeBody(req.body);
    }

    if (req.readableEnded || req.complete) {
        return undefined;
    }

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of req) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += bufferChunk.length;
        if (totalBytes > MAX_BODY_BYTES) {
            throw new Error(`Request body too large (>${MAX_BODY_BYTES} bytes)`);
        }
        chunks.push(bufferChunk);
    }

    if (!chunks.length) {
        return undefined;
    }
    return Buffer.concat(chunks, totalBytes);
}

function normalizeBody(body) {
    if (body === null || body === undefined) {
        return undefined;
    }
    if (typeof body === 'string') {
        return body;
    }
    if (Buffer.isBuffer(body)) {
        return body;
    }
    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }
    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (typeof body === 'object') {
        return JSON.stringify(body);
    }
    return String(body);
}

async function sendResponse(res, response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'set-cookie') {
            const existing = res.getHeader('Set-Cookie');
            const cookies = Array.isArray(existing) ? existing : existing ? [existing] : [];
            cookies.push(value);
            res.setHeader('Set-Cookie', cookies);
        } else {
            res.setHeader(key, value);
        }
    });

    if (!response.body) {
        res.end();
        return;
    }

    const readable = Readable.fromWeb(response.body);
    await new Promise((resolve, reject) => {
        readable.on('error', reject);
        res.on('error', reject);
        res.on('close', resolve);
        readable.on('end', resolve);
        readable.pipe(res);
    });
}
