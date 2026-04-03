import nodemailer from "nodemailer";

const SMTP_HOST = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false").trim().toLowerCase() === "true";
const SMTP_USER = String(process.env.SMTP_USER || "").trim();
const SMTP_PASS = String(process.env.SMTP_PASS || "").trim();
const SMTP_FROM = String(process.env.SMTP_FROM || SMTP_USER).trim();

let transporter: nodemailer.Transporter | null = null;

export const isSmtpConfigured = () => Boolean(SMTP_USER && SMTP_PASS);

export const getSmtpMissingConfigMessage = () =>
  "SMTP is not configured. Please set SMTP_USER and SMTP_PASS in environment variables.";

const getOtpSubjectByPurpose = (purpose: string) => {
  const normalizedPurpose = String(purpose || "").trim().toLowerCase();

  if (normalizedPurpose === "register") {
    return "Ma OTP dang ky tai khoan";
  }

  if (normalizedPurpose === "reset_password") {
    return "Ma OTP dat lai mat khau";
  }

  if (normalizedPurpose === "admin_create_user") {
    return "Ma OTP xac nhan tao tai khoan";
  }

  return "Ma OTP xac thuc";
};

const getTransporter = () => {
  if (!isSmtpConfigured()) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });
  }

  return transporter;
};

export const sendOtpEmail = async ({
  to,
  otp,
  purpose = "auth",
  expiresInMinutes = 5,
}: {
  to: string;
  otp: string;
  purpose?: string;
  expiresInMinutes?: number;
}) => {
  const normalizedEmail = String(to || "").trim().toLowerCase();
  const normalizedOtp = String(otp || "").trim();

  if (!normalizedEmail || !normalizedOtp) {
    throw new Error("Email and OTP are required.");
  }

  const emailTransporter = getTransporter();
  const subject = getOtpSubjectByPurpose(purpose);
  const appName = String(process.env.APP_NAME || "Football Booking").trim();
  const expiresLabel = Math.max(Number(expiresInMinutes) || 0, 1);

  return emailTransporter.sendMail({
    from: SMTP_FROM ? `"${appName}" <${SMTP_FROM}>` : SMTP_USER,
    to: normalizedEmail,
    subject,
    text: `Ma OTP cua ban la: ${normalizedOtp}. Ma co hieu luc trong ${expiresLabel} phut.`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">${appName}</h2>
        <p>Ma OTP cua ban la:</p>
        <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 8px 0 12px;">
          ${normalizedOtp}
        </p>
        <p>Ma co hieu luc trong ${expiresLabel} phut.</p>
      </div>
    `,
  });
};
