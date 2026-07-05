import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from './env';

/**
 * S3-compatible object storage (Cloudflare R2, Supabase Storage, MinIO, AWS).
 * Endpoint is configurable; forcePathStyle keeps MinIO/Supabase happy.
 */

const globalForS3 = globalThis as unknown as { __fastbillS3?: S3Client };

function client(): S3Client {
  globalForS3.__fastbillS3 ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return globalForS3.__fastbillS3;
}

export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await client().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`empty object at ${key}`);
  return Buffer.from(bytes);
}

/** Short-lived presigned download URL (default 5 minutes). */
export async function presignDownload(
  key: string,
  opts: { filename?: string; expiresIn?: number } = {}
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: key,
    ...(opts.filename
      ? { ResponseContentDisposition: `attachment; filename="${opts.filename.replace(/[^\w.-]/g, '_')}"` }
      : {}),
  });
  return getSignedUrl(client(), cmd, { expiresIn: opts.expiresIn ?? 300 });
}

/** Storage key layout — single place so paths never drift. */
export const storageKeys = {
  invoiceXml: (userId: string, invoiceId: string) => `invoices/${userId}/${invoiceId}/invoice.xml`,
  invoiceZip: (userId: string, invoiceId: string) => `invoices/${userId}/${invoiceId}/signed.zip`,
  invoiceErrorZip: (userId: string, invoiceId: string) => `invoices/${userId}/${invoiceId}/error.zip`,
  invoicePdf: (userId: string, invoiceId: string) => `invoices/${userId}/${invoiceId}/invoice.pdf`,
  archiveZip: (userId: string, companyId: string, messageId: string) =>
    `archive/${userId}/${companyId}/${messageId}.zip`,
  archiveXml: (userId: string, companyId: string, messageId: string) =>
    `archive/${userId}/${companyId}/${messageId}.xml`,
};
