import { EventSchemas, Inngest } from 'inngest';

type Events = {
  'invoice/create.requested': {
    data: {
      invoiceId: string;
    };
  };
  'archive/company.sync': {
    data: {
      companyId: string;
      /** Manual "Sync now" runs bypass the archiveEnabled check. */
      manual?: boolean;
    };
  };
};

export const inngest = new Inngest({
  id: 'fastbill',
  schemas: new EventSchemas().fromRecord<Events>(),
});
