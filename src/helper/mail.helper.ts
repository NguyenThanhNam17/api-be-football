import nodemailer from "nodemailer";
import dns from "node:dns";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15000;
const DEFAULT_GREETING_TIMEOUT_MS = 10000;
const DEFAULT_SOCKET_TIMEOUT_MS = 20000;

const SMTP_CONNECTION_ERROR_CODES = new Set([
  "ECONNECTION",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ESOCKET",
  "ETIMEDOUT",
]);

const SMTP_AUTH_ERROR_CODES = new Set(["EAUTH"]);

type MailErrorLike = {
  code?: string;
  command?: string;
  response?: string;
  message?: string;
};

type SmtpRuntimeConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  service: string;
  appName: string;
  requireTls: boolean;
  tlsRejectUnauthorized: boolean;
  debug: boolean;
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  addressFamily: 0 | 4 | 6;
};

let transporter: nodemailer.Transporter | null = null;
let transporterCacheKey = "";

const parseBooleanEnv = (value: string | undefined, fallback = false) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized) {
    return fallback;
  }

  return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const parsePositiveNumberEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseAddressFamilyEnv = (value: string | undefined, fallback: 0 | 4 | 6 = 0): 0 | 4 | 6 => {
  const parsed = Number(value);
  return parsed === 4 || parsed === 6 ? parsed : fallback;
};

const readSmtpConfig = (): SmtpRuntimeConfig => {
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const host = String(process.env.SMTP_HOST || DEFAULT_SMTP_HOST).trim() || DEFAULT_SMTP_HOST;
  const port = parsePositiveNumberEnv(process.env.SMTP_PORT, DEFAULT_SMTP_PORT);
  const secure = parseBooleanEnv(process.env.SMTP_SECURE, port === 465);

  return {
    host,
    port,
    secure,
    user,
    pass,
    from: String(process.env.SMTP_FROM || user).trim(),
    service: String(process.env.SMTP_SERVICE || "").trim(),
    appName: String(process.env.APP_NAME || "Football Booking").trim() || "Football Booking",
    requireTls: parseBooleanEnv(process.env.SMTP_REQUIRE_TLS, !secure),
    tlsRejectUnauthorized: parseBooleanEnv(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
    debug: parseBooleanEnv(process.env.SMTP_DEBUG, false),
    connectionTimeout: parsePositiveNumberEnv(
      process.env.SMTP_CONNECTION_TIMEOUT_MS,
      DEFAULT_CONNECTION_TIMEOUT_MS,
    ),
    greetingTimeout: parsePositiveNumberEnv(
      process.env.SMTP_GREETING_TIMEOUT_MS,
      DEFAULT_GREETING_TIMEOUT_MS,
    ),
    socketTimeout: parsePositiveNumberEnv(
      process.env.SMTP_SOCKET_TIMEOUT_MS,
      DEFAULT_SOCKET_TIMEOUT_MS,
    ),
    addressFamily: parseAddressFamilyEnv(
      process.env.SMTP_ADDRESS_FAMILY,
      host === DEFAULT_SMTP_HOST ? 4 : 0,
    ),
  };
};

const getTransporterCacheKey = (config: SmtpRuntimeConfig) =>
  JSON.stringify({
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    pass: config.pass,
    from: config.from,
    service: config.service,
    requireTls: config.requireTls,
    tlsRejectUnauthorized: config.tlsRejectUnauthorized,
    debug: config.debug,
    connectionTimeout: config.connectionTimeout,
    greetingTimeout: config.greetingTimeout,
    socketTimeout: config.socketTimeout,
    addressFamily: config.addressFamily,
  });

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

const extractMailError = (error: unknown): MailErrorLike => {
  if (!error || typeof error !== "object") {
    return {
      message: String(error || "").trim(),
    };
  }

  const mailError = error as MailErrorLike;
  return {
    code: String(mailError.code || "").trim().toUpperCase(),
    command: String(mailError.command || "").trim(),
    response: String(mailError.response || "").trim(),
    message: String(mailError.message || "").trim(),
  };
};

const messageContains = (message: string, patterns: string[]) => {
  const normalizedMessage = String(message || "").trim().toLowerCase();
  return patterns.some((pattern) => normalizedMessage.includes(pattern));
};

export const isSmtpConfigured = () => {
  const config = readSmtpConfig();
  return Boolean(config.user && config.pass);
};

export const getSmtpMissingConfigMessage = () =>
  "SMTP is not configured. Please set SMTP_USER and SMTP_PASS in environment variables.";

export const getSmtpSendFailureMessage = (error: unknown) => {
  if (!isSmtpConfigured()) {
    return getSmtpMissingConfigMessage();
  }

  const mailError = extractMailError(error);
  const combinedMessage = [mailError.message, mailError.response].filter(Boolean).join(" ");

  if (
    SMTP_AUTH_ERROR_CODES.has(String(mailError.code || "").toUpperCase())
    || messageContains(combinedMessage, [
      "invalid login",
      "bad credentials",
      "authentication failed",
      "username and password not accepted",
      "missing credentials",
      "invalid credentials",
    ])
  ) {
    return "SMTP authentication failed. Check SMTP_USER and SMTP_PASS. If you use Gmail, use an App Password.";
  }

  if (
    SMTP_CONNECTION_ERROR_CODES.has(String(mailError.code || "").toUpperCase())
    || messageContains(combinedMessage, [
      "timeout",
      "timed out",
      "connection closed",
      "connection timeout",
      "greeting never received",
      "getaddrinfo",
      "network",
    ])
  ) {
    return "Can not connect to SMTP server. Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, and outbound network access on hosting.";
  }

  if (
    messageContains(combinedMessage, [
      "certificate",
      "tls",
      "ssl routines",
      "wrong version number",
      "self signed",
    ])
  ) {
    return "SMTP TLS handshake failed. Check SMTP_SECURE and TLS settings.";
  }

  return "Can not send OTP email. Check SMTP configuration on the server.";
};

export const logSmtpSendFailure = (
  error: unknown,
  context: Record<string, string | number | boolean | undefined> = {},
) => {
  const config = readSmtpConfig();
  const mailError = extractMailError(error);

  console.error("[OTP][SMTP] Send failed", {
    ...context,
    host: config.host,
    port: config.port,
    secure: config.secure,
    addressFamily: config.addressFamily,
    service: config.service || undefined,
    user: config.user || undefined,
    from: config.from || undefined,
    code: mailError.code || undefined,
    command: mailError.command || undefined,
    response: mailError.response || undefined,
    message: mailError.message || undefined,
  });
};

const resolveSmtpHost = async (config: SmtpRuntimeConfig) => {
  if (!config.addressFamily) {
    return {
      connectionHost: config.host,
      tlsServername: config.host,
    };
  }

  try {
    const lookupResult = await dns.promises.lookup(config.host, {
      family: config.addressFamily,
      all: false,
      verbatim: false,
    });

    return {
      connectionHost: String(lookupResult.address || config.host).trim() || config.host,
      tlsServername: config.host,
    };
  } catch (error) {
    console.warn("[OTP][SMTP] Host lookup fallback", {
      host: config.host,
      addressFamily: config.addressFamily,
      message: String((error as Error)?.message || error || "").trim(),
    });

    return {
      connectionHost: config.host,
      tlsServername: config.host,
    };
  }
};

const getTransporter = async () => {
  const config = readSmtpConfig();

  if (!config.user || !config.pass) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  const resolvedHost = await resolveSmtpHost(config);
  const cacheKey = `${getTransporterCacheKey(config)}|${resolvedHost.connectionHost}`;

  if (!transporter || transporterCacheKey !== cacheKey) {
    transporterCacheKey = cacheKey;

    transporter = nodemailer.createTransport({
      ...(config.service ? { service: config.service } : {}),
      host: resolvedHost.connectionHost,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTls,
      connectionTimeout: config.connectionTimeout,
      greetingTimeout: config.greetingTimeout,
      socketTimeout: config.socketTimeout,
      logger: config.debug,
      debug: config.debug,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      tls: {
        servername: resolvedHost.tlsServername,
        ...(config.tlsRejectUnauthorized
          ? {}
          : {
              rejectUnauthorized: false,
            }),
      },
    });
  }

  return {
    transporter,
    config,
  };
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

  const { transporter: emailTransporter, config } = await getTransporter();
  const subject = getOtpSubjectByPurpose(purpose);
  const expiresLabel = Math.max(Number(expiresInMinutes) || 0, 1);

  return emailTransporter.sendMail({
    from: config.from ? `"${config.appName}" <${config.from}>` : config.user,
    to: normalizedEmail,
    subject,
    text: `Ma OTP cua ban la: ${normalizedOtp}. Ma co hieu luc trong ${expiresLabel} phut.`,
    html: `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">${config.appName}</h2>
        <p>Ma OTP cua ban la:</p>
        <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 8px 0 12px;">
          ${normalizedOtp}
        </p>
        <p>Ma co hieu luc trong ${expiresLabel} phut.</p>
      </div>
    `,
  });
};
