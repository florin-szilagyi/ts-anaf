import { z } from 'zod';

// ^[a-z0-9][a-z0-9._-]*$ — disallows uppercase, slashes, leading dot/hyphen, spaces
export const contextNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'context name must match /^[a-z0-9][a-z0-9._-]*$/');

const authConfigSchema = z.object({
  clientId: z.string().min(1),
  redirectUri: z.string().min(1),
});

const contextDefaultsSchema = z
  .object({
    currency: z.string().optional(),
    output: z.enum(['stdout', 'file']).optional(),
  })
  .strict();

// On-disk shape — never includes name (name is derived from filename).
export const contextFileSchema = z
  .object({
    companyCui: z.string().min(1),
    environment: z.enum(['test', 'prod']),
    auth: authConfigSchema,
    defaults: contextDefaultsSchema.optional(),
  })
  .strict();

export type ContextFile = z.infer<typeof contextFileSchema>;

const cliConfigDefaultsSchema = z
  .object({
    output: z.enum(['stdout', 'file']).optional(),
    format: z.enum(['text', 'json']).optional(),
  })
  .strict();

export const cliConfigSchema = z
  .object({
    currentContext: contextNameSchema.optional(),
    defaults: cliConfigDefaultsSchema.optional(),
  })
  .strict();

export const tokenRecordSchema = z
  .object({
    refreshToken: z.string().min(1),
    accessToken: z.string().min(1).optional(),
    expiresAt: z.string().optional(),
    obtainedAt: z.string().optional(),
  })
  .strict();
