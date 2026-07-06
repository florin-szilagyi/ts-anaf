import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '@/lib/env';

export type Db = PostgresJsDatabase<typeof schema>;

// Plain Postgres wire protocol via postgres.js — works against Neon, Supabase,
// RDS or local docker without provider-specific drivers. A small pool suits
// serverless: each warm lambda keeps a couple of connections.
//
// Initialization is lazy (first property access) so importing this module at
// `next build` time — when no runtime env exists — never connects or throws.
const globalForDb = globalThis as unknown as { __fastbillDb?: Db };

function initDb(): Db {
  const sql = postgres(env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon/Supabase poolers do not support prepared statements in transaction mode.
    prepare: false,
  });
  return drizzle(sql, { schema });
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    globalForDb.__fastbillDb ??= initDb();
    const value = globalForDb.__fastbillDb[prop as keyof Db];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(globalForDb.__fastbillDb)
      : value;
  },
});

export { schema };
