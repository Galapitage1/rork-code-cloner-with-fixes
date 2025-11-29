import { createTRPCRouter } from "./create-context";
import hiRoute from "./routes/example/hi/route";
import { sendEmailProcedure } from "./routes/campaigns/send-email/route";
import { testEmailProcedure } from "./routes/campaigns/test-email/route";

export const appRouter = createTRPCRouter({
  example: createTRPCRouter({
    hi: hiRoute,
  }),
  campaigns: createTRPCRouter({
    sendEmail: sendEmailProcedure,
    testEmail: testEmailProcedure,
  }),
});

export type AppRouter = typeof appRouter;