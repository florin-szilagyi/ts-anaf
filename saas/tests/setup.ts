import { randomBytes } from 'node:crypto';

// Minimal valid env so the lazy env proxy validates in unit tests.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5432/fastbill_test';
process.env.FASTBILL_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
process.env.ANAF_CLIENT_ID ??= 'test-client-id';
process.env.ANAF_CLIENT_SECRET ??= 'test-client-secret';
process.env.ANAF_REDIRECT_URI ??= 'https://localhost:3000/api/anaf/callback';
process.env.S3_ENDPOINT ??= 'http://localhost:9000';
process.env.S3_REGION ??= 'auto';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
process.env.S3_BUCKET ??= 'fastbill-test';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';
