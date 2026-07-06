import type { NextRequest } from 'next/server';
import { invoiceFileResponse } from '@/lib/api/invoiceFiles';
import { withApiKey, type ApiContext } from '@/lib/api/withApiKey';

export const GET = withApiKey(async (_req: NextRequest, ctx: ApiContext, params) =>
  invoiceFileResponse(ctx, params.id, 'pdf')
);
