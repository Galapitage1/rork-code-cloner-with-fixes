import { z } from "zod";
import { publicProcedure } from "@/backend/trpc/create-context";
import nodemailer from "nodemailer";

const attachmentSchema = z.object({
  name: z.string(),
  content: z.string(),
  contentType: z.string(),
});

const smtpConfigSchema = z.object({
  host: z.string(),
  port: z.number(),
  secure: z.boolean().optional(),
  auth: z.object({
    user: z.string(),
    pass: z.string(),
  }),
});

const recipientSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
});

export const sendEmailProcedure = publicProcedure
  .input(
    z.object({
      smtpConfig: smtpConfigSchema,
      from: z.object({
        email: z.string().email(),
        name: z.string(),
      }),
      subject: z.string(),
      content: z.string(),
      format: z.enum(["text", "html"]),
      recipients: z.array(recipientSchema),
      attachments: z.array(attachmentSchema).optional(),
    })
  )
  .mutation(async ({ input }) => {
    const results = {
      total: input.recipients.length,
      successful: 0,
      failed: 0,
      errors: [] as { recipientId: string; recipientEmail: string; error: string }[],
    };

    let transporter: nodemailer.Transporter | null = null;

    try {
      transporter = nodemailer.createTransport({
        host: input.smtpConfig.host,
        port: input.smtpConfig.port,
        secure: input.smtpConfig.secure ?? input.smtpConfig.port === 465,
        auth: {
          user: input.smtpConfig.auth.user,
          pass: input.smtpConfig.auth.pass,
        },
      });

      await transporter.verify();
      console.log("SMTP connection verified successfully");
    } catch (error) {
      console.error("SMTP connection failed:", error);
      throw new Error(
        `Failed to connect to SMTP server: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    for (const recipient of input.recipients) {
      try {
        const mailOptions: nodemailer.SendMailOptions = {
          from: `"${input.from.name}" <${input.from.email}>`,
          to: recipient.email,
          subject: input.subject,
        };

        if (input.format === "html") {
          mailOptions.html = input.content;
        } else {
          mailOptions.text = input.content;
        }

        if (input.attachments && input.attachments.length > 0) {
          mailOptions.attachments = input.attachments.map((att) => ({
            filename: att.name,
            content: Buffer.from(att.content, "base64"),
            contentType: att.contentType,
          }));
        }

        await transporter.sendMail(mailOptions);
        results.successful++;
        console.log(`Email sent successfully to ${recipient.email}`);
      } catch (error) {
        results.failed++;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        results.errors.push({
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          error: errorMessage,
        });
        console.error(`Failed to send email to ${recipient.email}:`, error);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  });
