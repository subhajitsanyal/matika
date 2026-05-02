import { PgRateLimiter, decideFromCount } from '../src/rate_limiter';
import type { PgClient } from '../src/db';

describe('decideFromCount', () => {
  const config = { softLimit: 100, hardLimit: 500 };

  it('allows when count is well under both limits', () => {
    const d = decideFromCount(0, config);
    expect(d.allowed).toBe(true);
    expect(d.softCapReached).toBe(false);
    expect(d.callsToday).toBe(0);
    expect(d.remainingHard).toBe(500);
  });

  it('flags soft cap when count >= softLimit but < hardLimit', () => {
    const d = decideFromCount(100, config);
    expect(d.allowed).toBe(true);
    expect(d.softCapReached).toBe(true);
    expect(d.callsToday).toBe(100);
    expect(d.remainingHard).toBe(400);
  });

  it('soft cap stays true between soft and hard', () => {
    const d = decideFromCount(250, config);
    expect(d.allowed).toBe(true);
    expect(d.softCapReached).toBe(true);
  });

  it('blocks at exactly hardLimit', () => {
    const d = decideFromCount(500, config);
    expect(d.allowed).toBe(false);
    expect(d.softCapReached).toBe(true);
    expect(d.callsToday).toBe(500);
    expect(d.remainingHard).toBe(0);
  });

  it('blocks above hardLimit and clamps remaining to 0', () => {
    const d = decideFromCount(700, config);
    expect(d.allowed).toBe(false);
    expect(d.remainingHard).toBe(0);
  });

  it('boundary: callsToday=99 stays under soft cap', () => {
    expect(decideFromCount(99, config).softCapReached).toBe(false);
  });

  it('boundary: callsToday=499 still allowed (one under hard)', () => {
    expect(decideFromCount(499, config).allowed).toBe(true);
  });
});

describe('PgRateLimiter', () => {
  function stubClient(count: number | string): { client: PgClient; calls: Array<{ text: string; params?: unknown[] }> } {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client: PgClient = {
      async query<R>(text: string, params?: unknown[]) {
        calls.push({ text, params });
        return { rows: [{ count: String(count) }] as R[] };
      },
    };
    return { client, calls };
  }

  it('rejects negative limits at construction', () => {
    expect(
      () => new PgRateLimiter({} as PgClient, { softLimit: -1, hardLimit: 500 }),
    ).toThrow(/negative/);
  });

  it('rejects softLimit > hardLimit at construction', () => {
    expect(
      () => new PgRateLimiter({} as PgClient, { softLimit: 600, hardLimit: 500 }),
    ).toThrow(/cannot exceed/);
  });

  it('queries model_call for the current UTC day', async () => {
    const { client, calls } = stubClient(0);
    const limiter = new PgRateLimiter(client, { softLimit: 100, hardLimit: 500 });
    await limiter.check('patient-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain('FROM model_call');
    expect(calls[0].text).toContain("date_trunc('day', NOW() AT TIME ZONE 'UTC')");
    expect(calls[0].params).toEqual(['patient-1']);
  });

  it('parses NUMERIC count returned as string', async () => {
    const { client } = stubClient('142');
    const limiter = new PgRateLimiter(client, { softLimit: 100, hardLimit: 500 });
    const decision = await limiter.check('patient-1');
    expect(decision.callsToday).toBe(142);
    expect(decision.allowed).toBe(true);
    expect(decision.softCapReached).toBe(true);
  });

  it('blocks at hard cap', async () => {
    const { client } = stubClient(500);
    const limiter = new PgRateLimiter(client, { softLimit: 100, hardLimit: 500 });
    const decision = await limiter.check('patient-1');
    expect(decision.allowed).toBe(false);
    expect(decision.remainingHard).toBe(0);
  });

  it('allows fresh patient with no calls', async () => {
    const { client } = stubClient(0);
    const limiter = new PgRateLimiter(client, { softLimit: 100, hardLimit: 500 });
    const decision = await limiter.check('patient-1');
    expect(decision.callsToday).toBe(0);
    expect(decision.allowed).toBe(true);
    expect(decision.softCapReached).toBe(false);
    expect(decision.remainingHard).toBe(500);
  });

  it('handles empty result rows defensively (returns 0)', async () => {
    const calls: Array<{ text: string; params?: unknown[] }> = [];
    const client: PgClient = {
      async query<R>(text: string, params?: unknown[]) {
        calls.push({ text, params });
        return { rows: [] as R[] };
      },
    };
    const limiter = new PgRateLimiter(client, { softLimit: 100, hardLimit: 500 });
    const decision = await limiter.check('p');
    expect(decision.callsToday).toBe(0);
    expect(decision.allowed).toBe(true);
  });
});
