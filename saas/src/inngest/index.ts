export { inngest } from './client';
export { invoiceCreate } from './functions/invoiceCreate';
export { archiveCron, archiveCompanySync } from './functions/archiveSync';
export { tokenRefreshGuard } from './functions/tokenRefreshGuard';

import { archiveCompanySync, archiveCron } from './functions/archiveSync';
import { invoiceCreate } from './functions/invoiceCreate';
import { tokenRefreshGuard } from './functions/tokenRefreshGuard';

export const functions = [invoiceCreate, archiveCron, archiveCompanySync, tokenRefreshGuard];
