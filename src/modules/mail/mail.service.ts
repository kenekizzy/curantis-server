import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { otpEmailTemplate, resetPasswordEmailTemplate, sendAdminWelcomeEmail, successfulSignUpEmailTemplate, sendAdminPasswordUpdateEmail } from "./templates/email.template.js";

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private readonly resend: Resend;
    constructor() {
        this.resend = new Resend(process.env.RESEND_API_KEY!);
    }
    async sendOtpEmail(identifier: string, otp: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: 'CareGiverNG <onboarding@renteasy.com.ng>',
                to: identifier,
                subject: 'Your CareGiverNG verification code',
                html: otpEmailTemplate(otp),
            });

            if (error) {
                this.logger.error(`Failed to send OTP email to ${identifier}: ${error.name} - ${error.message}`);
            } else {
                this.logger.log(`OTP email sent successfully to ${identifier}. Message ID: ${data?.id}`);
            }
        } catch (err) {
            this.logger.error(`Exception occurred while sending OTP email to ${identifier}:`, err);
        }
    }

    async sendResetPasswordEmail(identifier: string, token: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: 'CareGiverNG <onboarding@renteasy.com.ng>',
                to: identifier,
                subject: 'Your CareGiverNG reset password link',
                html: resetPasswordEmailTemplate(token),
            });

            if (error) {
                this.logger.error(`Failed to send reset password email to ${identifier}: ${error.name} - ${error.message}`);
            } else {
                this.logger.log(`Reset password email sent successfully to ${identifier}. Message ID: ${data?.id}`);
            }
        } catch (err) {
            this.logger.error(`Exception occurred while sending reset password email to ${identifier}:`, err);
        }
    }

    async sendSuccessfulEmailSignUp(email: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: 'CareGiverNG <onboarding@renteasy.com.ng>',
                to: email,
                subject: 'Your CareGiverNG successful sign up',
                html: successfulSignUpEmailTemplate(email),
            });

            if (error) {
                this.logger.error(`Failed to send successful sign up email to ${email}: ${error.name} - ${error.message}`);
            } else {
                this.logger.log(`Successful sign up email sent successfully to ${email}. Message ID: ${data?.id}`);
            }
        } catch (err) {
            this.logger.error(`Exception occurred while sending successful sign up email to ${email}:`, err);
        }
    }

    async  sendAdminWelcomeEmail (email: string, password: string, adminRole: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: 'CareGiverNG <onboarding@renteasy.com.ng>',
                to: email,
                subject: 'Your CareGiverNG successful sign up',
                html: sendAdminWelcomeEmail(email, password, adminRole),
            });

            if (error) {
                this.logger.error(`Failed to send successful sign up email to ${email}: ${error.name} - ${error.message}`);
            } else {
                this.logger.log(`Successful sign up email sent successfully to ${email}. Message ID: ${data?.id}`);
            }
        } catch (err) {
            this.logger.error(`Exception occurred while sending successful sign up email to ${email}:`, err);
        }
    }

    async sendAdminPasswordUpdateEmail (email: string) {
        try {
            const { data, error } = await this.resend.emails.send({
                from: 'CareGiverNG <onboarding@renteasy.com.ng>',
                to: email,
                subject: 'Your CareGiverNG password has been updated',
                html: sendAdminPasswordUpdateEmail(email),
            });

            if (error) {
                this.logger.error(`Failed to send password update email to ${email}: ${error.name} - ${error.message}`);
            } else {
                this.logger.log(`Password update email sent successfully to ${email}. Message ID: ${data?.id}`);
            }
        } catch (err) {
            this.logger.error(`Exception occurred while sending password update email to ${email}:`, err);
        }
    }
}