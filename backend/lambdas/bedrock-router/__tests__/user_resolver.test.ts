import type { Pool } from 'pg';
import { PgUserResolver } from '../src/user_resolver';

interface CapturedQuery {
  text: string;
  values: readonly unknown[];
}

function makeFakePool(rowsByCognitoSub: Record<string, string | undefined>): {
  pool: Pool;
  queries: CapturedQuery[];
} {
  const queries: CapturedQuery[] = [];
  const fakePool = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values: values ?? [] });
      const sub = String(values?.[0] ?? '');
      const id = rowsByCognitoSub[sub];
      return id ? { rows: [{ id }] } : { rows: [] };
    },
  };
  return { pool: fakePool as unknown as Pool, queries };
}

describe('PgUserResolver', () => {
  it('resolves a known cognito sub to a users.id', async () => {
    const { pool, queries } = makeFakePool({ 'sub-aaa': 'user-uuid-1' });
    const resolver = new PgUserResolver(pool);
    const id = await resolver.resolveInternalId('sub-aaa');
    expect(id).toBe('user-uuid-1');
    expect(queries[0].text).toContain('SELECT id FROM users WHERE cognito_sub');
    expect(queries[0].values[0]).toBe('sub-aaa');
  });

  it('returns null when the sub is not found', async () => {
    const { pool } = makeFakePool({});
    const resolver = new PgUserResolver(pool);
    expect(await resolver.resolveInternalId('sub-unknown')).toBeNull();
  });

  it('caches results across calls — second call hits cache', async () => {
    const { pool, queries } = makeFakePool({ 'sub-cached': 'user-uuid-2' });
    const resolver = new PgUserResolver(pool);
    await resolver.resolveInternalId('sub-cached');
    await resolver.resolveInternalId('sub-cached');
    await resolver.resolveInternalId('sub-cached');
    expect(queries).toHaveLength(1); // only one DB hit
  });

  it('caches negative results — repeated unknown sub does not rehit DB', async () => {
    const { pool, queries } = makeFakePool({});
    const resolver = new PgUserResolver(pool);
    await resolver.resolveInternalId('sub-bad');
    await resolver.resolveInternalId('sub-bad');
    expect(queries).toHaveLength(1);
  });
});
