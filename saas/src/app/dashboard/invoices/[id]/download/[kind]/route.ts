import { auth } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db';
import { invoiceFileResponse, type InvoiceFileKind } from '@/lib/api/invoiceFiles';
import { failFromUnknown } from '@/lib/api/respond';

/** Dashboard downloads — Clerk-authed, both modes visible. */
export async function GET(
  _req: NextRequest,
  route: { params: Promise<{ id: string; kind: string }> }
): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) return NextResponse.redirect(new URL('/sign-in', _req.nextUrl.origin));
  const { id, kind } = await route.params;
  if (!['xml', 'zip', 'pdf'].includes(kind)) {
    return NextResponse.json(
      { success: false, error: { code: 'INVALID_REQUEST', message: 'bad kind' } },
      { status: 400 }
    );
  }
  try {
    return await invoiceFileResponse({ db, userId }, id, kind as InvoiceFileKind);
  } catch (cause) {
    return failFromUnknown(cause);
  }
}
