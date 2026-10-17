// Proteção contra SSRF: a varredura de links só pode alcançar a internet pública.

export type DnsResolver = (host: string) => Promise<string[]>;

const BLOCKED_HOSTS = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|metadata\.google\.internal)$/i;

/** Expande um IPv6 (com ou sem IPv4 embutido em pontos) para 16 bytes; null se inválido. */
function ipv6ToBytes(input: string): number[] | null {
  let value = input;
  const dotted = value.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[2].split('.').map(Number);
    if (parts.some(n => n > 255)) return null;
    value = `${dotted[1]}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 1 ? head : [...head, ...new Array(missing).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const n = parseInt(group, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes;
}

export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  if (value.includes(':')) {
    const b = ipv6ToBytes(value);
    if (!b) return true;
    const v4 = (o: number) => `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
    const zeros = (from: number, to: number) => b.slice(from, to).every(x => x === 0);
    if (zeros(0, 10) && b[10] === 255 && b[11] === 255) return isPrivateIp(v4(12)); // ::ffff:a.b.c.d
    if (zeros(0, 12)) return true; // ::, ::1 e IPv4-compatível
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && zeros(4, 12)) return isPrivateIp(v4(12)); // NAT64
    if (b[0] === 0x20 && b[1] === 0x02) return isPrivateIp(v4(2)); // 6to4
    return (b[0] & 0xe0) !== 0x20 || (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00); // só 2000::/3 (sem Teredo)
  }
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Lança erro se a URL não for http(s) público. Resolve o DNS para barrar nomes que apontam para IP interno. */
export async function assertPublicUrl(rawUrl: string, resolve?: DnsResolver): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('URL inválida');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Protocolo não permitido');
  if (url.username || url.password) throw new Error('URL com credenciais não permitida');
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '');
  if (BLOCKED_HOSTS.test(host)) throw new Error('Endereço interno bloqueado');

  const isIpLiteral = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':');
  if (isIpLiteral) {
    if (isPrivateIp(host)) throw new Error('Endereço interno bloqueado');
    assertAllowedPort(url);
    return url;
  }
  if (!host.includes('.')) throw new Error('Endereço interno bloqueado');
  if (resolve) {
    let addresses: string[];
    try {
      addresses = await resolve(host);
    } catch {
      throw new Error('Domínio não resolvido');
    }
    if (!addresses.length) throw new Error('Domínio não resolvido');
    if (addresses.some(isPrivateIp)) throw new Error('Endereço interno bloqueado');
  }
  assertAllowedPort(url);
  return url;
}

function assertAllowedPort(url: URL): void {
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta não permitida');
}

/**
 * Resolve DNS por DNS-over-HTTPS. Falha em A ou AAAA é erro (nunca "lista vazia"):
 * ignorar o AAAA deixaria o fetch conectar em IPv6 privado sem checagem.
 */
export function createDohResolver(fetchImpl: typeof fetch = fetch): DnsResolver {
  return async host => {
    const query = async (type: 'A' | 'AAAA'): Promise<string[]> => {
      const res = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
        headers: { Accept: 'application/dns-json' }
      });
      if (!res.ok) throw new Error(`DoH HTTP ${res.status}`);
      const body = await res.json();
      return (body.Answer ?? [])
        .filter((a: { type: number }) => a.type === (type === 'A' ? 1 : 28))
        .map((a: { data: string }) => a.data);
    };
    const [v4, v6] = await Promise.all([query('A'), query('AAAA')]);
    return [...v4, ...v6];
  };
}

export interface SafeFetchOptions {
  fetchImpl?: typeof fetch;
  resolve?: DnsResolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
  truncated: boolean;
}

/** fetch com timeout, limite de tamanho e revalidação a cada redirecionamento. */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const {
    fetchImpl = fetch, resolve, timeoutMs = 9000, maxBytes = 1_500_000, maxRedirects = 3, headers = {}
  } = options;

  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, resolve);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SegundoCerebroBot/1.0)',
          Accept: 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          ...headers
        }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error(`Redirecionamento sem destino (HTTP ${response.status})`);
        current = new URL(location, current).toString();
        continue;
      }
      const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
      const { text, truncated } = await readLimited(response, maxBytes);
      return { url: current, status: response.status, contentType, body: text, truncated };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new Error('Tempo esgotado ao acessar o link');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Redirecionamentos demais');
}

async function readLimited(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: await response.text(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(merged), truncated };
}
