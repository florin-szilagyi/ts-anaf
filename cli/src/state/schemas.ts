import { z } from 'zod';

function isLocalhostHttps(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === 'https:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export const credentialFileSchema = z
  .object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1).optional(),
    redirectUri: z.string().min(1).refine(isLocalhostHttps, {
      message: 'redirectUri must be an https://localhost (or 127.0.0.1) URL',
    }),
  })
  .strict();

export type CredentialFile = z.infer<typeof credentialFileSchema>;

export const companyFileSchema = z
  .object({
    cui: z.string().min(1),
    name: z.string().min(1),
    registrationNumber: z.string().optional(),
    address: z.string().optional(),
  })
  .strict();

export type CompanyFile = z.infer<typeof companyFileSchema>;

// Not .strict() — unknown keys (e.g. `currentContext` from older versions) are stripped on read.
export const cliConfigSchema = z.object({
  activeCui: z.string().optional(),
  env: z.enum(['test', 'prod']).optional(),
});

export const tokenRecordSchema = z
  .object({
    refreshToken: z.string().min(1),
    accessToken: z.string().min(1).optional(),
    expiresAt: z.string().optional(),
    obtainedAt: z.string().optional(),
  })
  .strict();

export const fastbillConfigSchema = z
  .object({
    apiKey: z.string().regex(/^sk_(test|live)_/, 'apiKey must be a fastbill secret key (sk_test_… or sk_live_…)'),
    baseUrl: z.string().url().optional(),
  })
  .strict();

export type FastbillConfig = z.infer<typeof fastbillConfigSchema>;
