import { sql } from 'drizzle-orm';
import type { Db } from '@/db';

/** Idempotently mirror the Clerk user into our users table. */
export async function ensureUser(db: Db, userId: string, email?: string | null): Promise<void> {
  await db.execute(sql`
    insert into users (id, email) values (${userId}, ${email ?? null})
    on conflict (id) do update set email = coalesce(excluded.email, users.email)
  `);
}
