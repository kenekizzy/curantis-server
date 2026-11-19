import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { MailService } from '../../mail/mail.service.js';
import { notificationEmailTemplate } from '../../mail/templates/email.template.js';

type NotificationMetadata = Parameters<
  PrismaService['notification']['create']
>[0]['data']['metadata'];

const NOTIFICATION_TITLES: Record<string, string> = {
  BOOKING_REQUEST: 'New booking request',
  BOOKING_ACCEPTED: 'Your booking was accepted',
  BOOKING_COMPLETE: 'Booking completed',
  PAYMENT_CONFIRMED: 'Payment confirmed',
  VERIFICATION_UPDATE: 'Verification status updated',
};

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);
  private readonly resend: Resend;

  constructor(private readonly prisma: PrismaService, private readonly mailService: MailService) {
    super();
    this.resend = new Resend(process.env.RESEND_API_KEY!);
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'send-notification') {
      const { userId, type, bookingId, metadata } = job.data as {
        userId?: string;
        type: string;
        bookingId?: string;
        metadata?: NotificationMetadata;
      };

      if (!userId) return;

      const title = NOTIFICATION_TITLES[type] ?? 'CareGiverNG update';
      const body = bookingId ? `Reference: ${bookingId}` : title;

      await this.prisma.notification.create({
        data: { userId, type, title, body, metadata },
      });

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });
      if (user?.email) {
        try {
          const { data, error } = await this.resend.emails.send({
            from: 'CareGiverNG <onboarding@renteasy.com.ng>',
            to: user.email,
            subject: title,
            html: notificationEmailTemplate(title, body),
          });

          if (error) {
            this.logger.error(`Failed to send email to ${user.email}: ${error.name} - ${error.message}`);
          } else {
            this.logger.log(`Email sent successfully to ${user.email}. Message ID: ${data?.id}`);
          }
        } catch (err) {
          this.logger.error(`Exception occurred while sending email to ${user.email}:`, err);
        }
      }
    }

    if (job.name === 'send-otp' || job.name === 'send-otp-sms') {
      const { identifier, otp } = job.data as { identifier: string; otp: string };

      // Phone-based OTP delivery disabled — OTPs are sent to email only, via Resend.
      // if (!identifier.includes('@')) {
      //   await this.sendSms(identifier, `Your CareGiverNG verification code is ${otp}`);
      // }

      await this.mailService.sendOtpEmail(identifier, otp);
    }

    if (job.name === 'alert-super-admin') {
      const { reportId, category } = job.data as { reportId: string; category: string };

      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      });

      if (admins.length > 0) {
        const alertMetadata = { reportId, category, urgent: true } as NotificationMetadata;
        await this.prisma.notification.createMany({
          data: admins.map((admin) => ({
            userId: admin.id,
            type: 'SAFEGUARDING_ALERT',
            title: 'Urgent safeguarding report',
            body: `A ${category} report (${reportId}) requires immediate review.`,
            metadata: alertMetadata,
          })),
        });
      }
    }

    if (job.name === 'send-reset-link') {
      const { identifier, token } = job.data as { identifier: string; token: string };

      await this.mailService.sendResetPasswordEmail(identifier, token);
    }

    if (job.name === 'send-successful-signup-email') {
      const { email } = job.data as { email: string };

      await this.mailService.sendSuccessfulEmailSignUp(email);
    }

    if (job.name === 'send-admin-welcome') {
      const { email, password, adminRole } = job.data as { email: string; password: string; adminRole: string };

      await this.mailService.sendAdminWelcomeEmail(email, password, adminRole);
    }

    if (job.name === "admin-password-update"){
      const {email} = job.data as {email: string};

      await this.mailService.sendAdminPasswordUpdateEmail(email);
    }
  }

  // private async sendSms(phone: string, message: string): Promise<void> {
  //   await fetch('https://api.ng.termii.com/api/sms/send', {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       api_key: process.env.TERMII_API_KEY,
  //       to: phone,
  //       from: process.env.TERMII_SENDER_ID ?? 'CareGiverNG',
  //       sms: message,
  //       type: 'plain',
  //       channel: 'generic',
  //     }),
  //   });
  // }
}
