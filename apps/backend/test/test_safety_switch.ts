export function assertMoonrakerTestBaseUrlSafe(baseUrl: string): void {
  const u = new URL(baseUrl);
  const host = u.hostname.toLowerCase();

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return;

  if (host.endsWith('.local')) {
    throw new Error(`Unsafe baseUrl for write integration tests: ${baseUrl}`);
  }

  // IPv4 private ranges
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);

    if (a === 10) {
      throw new Error(`Unsafe baseUrl for write integration tests: ${baseUrl}`);
    }
    if (a === 192 && b === 168) {
      throw new Error(`Unsafe baseUrl for write integration tests: ${baseUrl}`);
    }
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error(`Unsafe baseUrl for write integration tests: ${baseUrl}`);
    }
  }

  throw new Error(
    `Unsafe baseUrl for write integration tests (only localhost allowed): ${baseUrl}`,
  );
}
