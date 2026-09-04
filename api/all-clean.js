import { handleUnifiedSubscription } from '../src/unifiedSubscription.js';

export const config = {
  runtime: 'nodejs'
};

function getRequestUrl(req) {
  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  return `${protocol}://${host}${req.url || '/api/all-clean'}`;
}

function detectRegion(name) {
  const text = String(name || '');
  if (/(香港|\bHK\b|Hong\s*Kong)/i.test(text)) return 'HK';
  if (/(日本|\bJP\b|Japan|Tokyo|Osaka)/i.test(text)) return 'JP';
  if (/(新加坡|狮城|\bSG\b|Singapore)/i.test(text)) return 'SG';
  if (/(台湾|台灣|\bTW\b|Taiwan|Taipei)/i.test(text)) return 'TW';
  if (/(美国|\bUS\b|USA|United\s*States)/i.test(text)) return 'US';
  return text.replace(/_?\d+\s*$/, '').trim() || 'OTHER';
}

function canonicalProxy(line) {
  const eq = line.indexOf('=');
  if (eq < 0) return line.trim();
  return line.slice(eq + 1)
    .split(',')
    .map((part) => part.trim())
    .join(',');
}

function cleanAirportB(lines) {
  const kept = [];
  const seen = new Set();
  let rawCount = 0;

  for (const line of lines) {
    if (!/^B\s+/i.test(line)) {
      kept.push(line);
      continue;
    }

    rawCount += 1;
    const eq = line.indexOf('=');
    const name = eq >= 0 ? line.slice(0, eq).trim() : line.trim();
    const region = detectRegion(name);
    const key = `${region}|${canonicalProxy(line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }

  return {
    lines: kept,
    rawCount,
    cleanCount: seen.size
  };
}

function cleanAirportA(lines) {
  const kept = [];
  const seen = new Set();
  let rawCount = 0;

  for (const line of lines) {
    if (!/^A\s+/i.test(line)) {
      kept.push(line);
      continue;
    }

    rawCount += 1;
    const key = canonicalProxy(line);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(line);
  }

  return {
    lines: kept,
    rawCount,
    cleanCount: seen.size
  };
}

export default async function handler(req, res) {
  try {
    const url = new URL(getRequestUrl(req));
    const upstreamUrl = new URL('/all', url.origin);
    const key = url.searchParams.get('key');
    if (key) upstreamUrl.searchParams.set('key', key);

    const response = await handleUnifiedSubscription(new Request(upstreamUrl.toString()), process.env);
    if (!response.ok) {
      res.statusCode = response.status;
      response.headers.forEach((value, header) => res.setHeader(header, value));
      res.end(await response.text());
      return;
    }

    const text = await response.text();
    const sourceLines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const cleanedB = cleanAirportB(sourceLines);
    const cleanedA = cleanAirportA(cleanedB.lines);
    const finalLines = cleanedA.lines;

    const aCount = finalLines.filter((x) => /^A\s+/i.test(x)).length;
    const bCount = finalLines.filter((x) => /^B\s+/i.test(x)).length;
    const cCount = finalLines.filter((x) => /^C\s+/i.test(x)).length;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    res.setHeader('X-Airport-A-Raw-Nodes', String(cleanedA.rawCount));
    res.setHeader('X-Airport-A-Nodes', String(aCount));
    res.setHeader('X-Airport-B-Raw-Nodes', String(cleanedB.rawCount));
    res.setHeader('X-Airport-B-Nodes', String(bCount));
    res.setHeader('X-Airport-C-Nodes', String(cCount));
    res.setHeader('X-Airport-Total-Nodes', String(finalLines.length));
    const userInfo = response.headers.get('subscription-userinfo');
    if (userInfo) res.setHeader('subscription-userinfo', userInfo);
    res.end(`${finalLines.join('\n')}\n`);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Airport cleaner failed: ${error?.message || String(error)}`);
  }
}
