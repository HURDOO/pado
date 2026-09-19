import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { request } from 'node:http';

// Operator tool only. This file and its credentials are never mounted in an app/agent container.
const action = process.argv[2] || 'inspect';
if (!['inspect', 'prepare', 'prepare-previews', 'activate', 'maintenance'].includes(action))
  throw new Error('Use inspect, prepare, prepare-previews, activate or maintenance');
const file = resolve(process.env.PADO_CLOUDFLARE_TOKEN_FILE || 'CLOUDFLARE_API_TOKEN.secret');
const metadata = await lstat(file);
if (
  !metadata.isFile() ||
  metadata.isSymbolicLink() ||
  metadata.uid !== process.getuid() ||
  metadata.mode & 0o077 ||
  metadata.size > 4096
)
  throw new Error('API token must be an owner-only regular file');
const raw = await readFile(file, 'utf8');
const env = parseEnv(raw);
const token = env.CLOUDFLARE_API_TOKEN || env.CF_API_TOKEN || raw.trim();
if (!/^[A-Za-z0-9._~-]{20,512}$/.test(token)) throw new Error('Invalid API token format');
async function api(path, method = 'GET', body) {
  const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(
      `Cloudflare ${method} failed: HTTP ${response.status}; codes ${(data.errors || []).map((e) => e.code).join(',')}`,
    );
  }
  return data.result;
}
try {
  const zones = await api('/zones?name=hurdoo.kr');
  const zone = zones.find((z) => z.name === 'hurdoo.kr' && z.status === 'active');
  if (!zone) throw new Error('Active hurdoo.kr zone not found');
  const account = zone.account.id;
  const matches = await api(`/accounts/${account}/cfd_tunnel?is_deleted=false&name=pado`);
  let tunnel = matches.find((t) => t.name === 'pado');
  const dns = await api(`/zones/${zone.id}/dns_records?name=pado.hurdoo.kr`);
  console.log(
    JSON.stringify({
      zone: zone.name,
      tunnelAccess: true,
      tunnelExists: !!tunnel,
      dns: dns.map((r) => ({ type: r.type, name: r.name, proxied: r.proxied })),
    }),
  );
  if (action === 'prepare') {
    if (
      dns.length &&
      (!tunnel ||
        dns.some((r) => r.type !== 'CNAME' || r.content !== `${tunnel.id}.cfargotunnel.com`))
    )
      throw new Error('Pado DNS already belongs to another target');
    if (!tunnel) {
      tunnel = await api(`/accounts/${account}/cfd_tunnel`, 'POST', {
        name: 'pado',
        config_src: 'cloudflare',
      });
      // Public routes remain unavailable until the app's public isolation checks pass.
      await api(`/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`, 'PUT', {
        config: { ingress: [{ service: 'http_status:503' }] },
      });
    }
    const configuration = await api(`/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`);
    if (configuration.config.ingress.some((rule) => rule.service !== 'http_status:503'))
      throw new Error('Existing tunnel has live routes; inspect before changing it');
    const directory = resolve('.pado', 'tunnel');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const connectorToken = await api(`/accounts/${account}/cfd_tunnel/${tunnel.id}/token`);
    await writeFile(resolve(directory, 'connector.secret'), connectorToken, { mode: 0o600 });
    await writeFile(
      resolve(directory, 'metadata.json'),
      JSON.stringify({ account, zone: zone.id, tunnel: tunnel.id }),
      { mode: 0o600 },
    );
    if (!dns.length)
      await api(`/zones/${zone.id}/dns_records`, 'POST', {
        type: 'CNAME',
        name: 'pado.hurdoo.kr',
        content: `${tunnel.id}.cfargotunnel.com`,
        proxied: true,
        ttl: 1,
      });
    console.log(
      JSON.stringify({
        prepared: true,
        hostname: 'pado.hurdoo.kr',
        ingress: 'maintenance-503',
        credentialsStored: true,
      }),
    );
  }
  if (['prepare-previews', 'activate', 'maintenance'].includes(action)) {
    const saved = JSON.parse(await readFile(resolve('.pado/tunnel/metadata.json'), 'utf8'));
    if (
      !tunnel ||
      tunnel.id !== saved.tunnel ||
      account !== saved.account ||
      zone.id !== saved.zone
    )
      throw new Error('Prepared Pado tunnel identity does not match');
    const previews = Array.from({ length: 12 }, (_, slot) =>
      [3000, 3001, 5173, 8080].map((port, index) => ({
        hostname: `pado-app-${slot}-${port}.hurdoo.kr`,
        service: `http://127.0.0.1:${4273 + slot * 4 + index}`,
      })),
    ).flat();
    const routes = [{ hostname: 'pado.hurdoo.kr', service: 'http://127.0.0.1:4173' }, ...previews];
    const previous = await api(`/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`);
    const validRule = (rule) =>
      (!rule.hostname && ['http_status:503', 'http_status:404'].includes(rule.service)) ||
      routes.some((route) => route.hostname === rule.hostname && route.service === rule.service);
    if (!previous.config.ingress.every(validRule)) throw new Error('Unrecognized existing ingress');
    if (action !== 'maintenance') {
      for (const route of routes) {
        const records = await api(
          `/zones/${zone.id}/dns_records?name=${encodeURIComponent(route.hostname)}`,
        );
        if (
          records.some(
            (record) =>
              record.type !== 'CNAME' ||
              record.content !== `${tunnel.id}.cfargotunnel.com` ||
              !record.proxied,
          )
        )
          throw new Error('Conflicting Pado DNS record');
        if (!records.length)
          await api(`/zones/${zone.id}/dns_records`, 'POST', {
            type: 'CNAME',
            name: route.hostname,
            content: `${tunnel.id}.cfargotunnel.com`,
            proxied: true,
            ttl: 1,
          });
      }
      console.log(JSON.stringify({ preparedHostnames: routes.length }));
    }
    if (action === 'activate') {
      const health = await new Promise((done, fail) => {
        const req = request(
          'http://127.0.0.1:4173/api/health',
          { headers: { Host: 'pado.hurdoo.kr' }, timeout: 5000 },
          (res) => {
            let body = '';
            res.on('data', (chunk) => {
              body += chunk;
              if (body.length > 4096) req.destroy();
            });
            res.on('end', () => {
              try {
                done(res.statusCode === 200 ? JSON.parse(body) : null);
              } catch {
                fail(new Error('Invalid readiness response'));
              }
            });
          },
        );
        req.on('timeout', () => req.destroy(new Error('Readiness timed out')));
        req.on('error', fail);
        req.end();
      });
      if (
        !health?.ok ||
        !health.publicMode ||
        !health.production ||
        health.runner !== 'antigravity'
      )
        throw new Error('Public backend readiness is required');
    }
    if (['activate', 'maintenance'].includes(action)) {
      await writeFile(
        resolve('.pado/tunnel/previous-ingress.json'),
        JSON.stringify(previous.config),
        { mode: 0o600 },
      );
      const ingress =
        action === 'maintenance'
          ? [{ service: 'http_status:503' }]
          : [
              ...routes.map((route) => ({
                ...route,
                originRequest: { httpHostHeader: route.hostname },
              })),
              { service: 'http_status:404' },
            ];
      await api(`/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`, 'PUT', {
        config: { ingress },
      });
      console.log(
        JSON.stringify({
          ingress: action === 'activate' ? 'live' : 'maintenance-503',
          hostname: 'pado.hurdoo.kr',
        }),
      );
    }
  }
} catch (error) {
  // Deliberately omit response bodies, request headers, tokens and private filesystem errors.
  console.error(
    error.message.startsWith('Cloudflare ')
      ? error.message
      : 'Cloudflare preparation could not complete safely.',
  );
  process.exitCode = 1;
}
