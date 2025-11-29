import { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";

export const createContext = async (opts: FetchCreateContextFnOptions) => {
  const env = (opts.req as any).env || {};
  
  return {
    req: opts.req,
    env,
    user: null,
  };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure;