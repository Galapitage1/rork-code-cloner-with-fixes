import { createTRPCRouter } from "./create-context";
import hiRoute from "./routes/example/hi/route";
import { sendEmailProcedure } from "./routes/campaigns/send-email/route";
import { testEmailProcedure } from "./routes/campaigns/test-email/route";
import { saveDataProcedure } from "./routes/data/save/route";
import { getDataProcedure } from "./routes/data/get/route";
import { getLastUpdatedProcedure } from "./routes/data/get-last-updated/route";

export const appRouter = createTRPCRouter({
  example: createTRPCRouter({
    hi: hiRoute,
  }),
  campaigns: createTRPCRouter({
    sendEmail: sendEmailProcedure,
    testEmail: testEmailProcedure,
  }),
  data: createTRPCRouter({
    save: saveDataProcedure,
    get: getDataProcedure,
    getLastUpdated: getLastUpdatedProcedure,
  }),
});

export type AppRouter = typeof appRouter;