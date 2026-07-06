import { z } from 'zod';

/**
 * Zod-validated environment. Fails fast with a readable message instead of
 * undefined-creep at request time.
 *
 * Optional groups degrade gracefully in local dev:
 *  - Upstash empty → in-memory rate limiter (single process only)
 *  - Inngest keys empty → inngest dev server mode
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  FASTBILL_ENCRYPTION_KEY: z
    .string()
    .min(1, 'FASTBILL_ENCRYPTION_KEY is required (32 random bytes, base64)')
    .refine((v) => {
      try {
        return Buffer.from(v, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'FASTBILL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)'),
  ANAF_CLIENT_ID: z.string().min(1),
  ANAF_CLIENT_SECRET: z.string().min(1),
  ANAF_REDIRECT_URI: z.string().url(),
  CLERK_SECRET_KEY: z.string().optional().default(''),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  UPSTASH_REDIS_REST_URL: z.string().optional().default(''),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional().default(''),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`fastbill env validation failed — ${missing}`);
  }
  return parsed.data;
}

/**
 * Lazy proxy so importing this module never throws at build time (Next
 * evaluates modules during `next build` without runtime env). Access to any
 * property validates the full env once.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    cached ??= loadEnv();
    return cached[prop as keyof Env];
  },
});

/** Test hook: reset the memoized env (vitest only). */
export function __resetEnvForTests(): void {
  cached = undefined;
}
