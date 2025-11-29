import { z } from "zod";
import { publicProcedure } from "@/backend/trpc/create-context";
import nodemailer from "nodemailer";

const smtpConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean().optional(),
  auth: z.object({
    user: z.string(),
    pass: z.string(),
  }),
});

export const testEmailProcedure = publicProcedure
  .input(
    z.object({
      smtpConfig: smtpConfigSchema,
      testEmail: z.string().email(),
    })
  )
  .mutation(async ({ input }) => {
    try {
      const transporter = nodemailer.createTransport({
        host: input.smtpConfig.host,
        port: input.smtpConfig.port,
        secure: input.smtpConfig.secure ?? input.smtpConfig.port === 465,
        auth: {
          user: input.smtpConfig.auth.user,
          pass: input.smtpConfig.auth.pass,
        },
      });

      await transporter.verify();

      await transporter.sendMail({
        from: `"Test Email" <${input.smtpConfig.auth.user}>`,
        to: input.testEmail,
        subject: "Test Email from Campaign Manager",
        text: "This is a test email to verify your SMTP configuration.",
        html: "<p>This is a test email to verify your SMTP configuration.</p>",
      });

      return {
        success: true,
        message: "Test email sent successfully!",
      };
    } catch (error) {
      console.error("SMTP test failed:", error);
      throw new Error(
        `SMTP test failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  });
