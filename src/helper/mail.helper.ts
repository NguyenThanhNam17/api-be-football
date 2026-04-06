import nodemailer from "nodemailer";
import dns from "node:dns";
import https from "node:https";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15000;
const DEFAULT_GREETING_TIMEOUT_MS = 10000;
const DEFAULT_SOCKET_TIMEOUT_MS = 20000;
const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";

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

type ResendRuntimeConfig = {
  apiKey: string;
  from: string;
  replyTo: string;
  apiUrl: string;
  appName: string;
  timeoutMs: number;
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

const readResendConfig = (): ResendRuntimeConfig => ({
  apiKey: String(process.env.RESEND_API_KEY || "").trim(),
  from: String(
    process.env.RESEND_FROM
    || process.env.SMTP_FROM
    || process.env.SMTP_USER
    || "",
  ).trim(),
  replyTo: String(process.env.RESEND_REPLY_TO || "").trim(),
  apiUrl: String(process.env.RESEND_API_URL || DEFAULT_RESEND_API_URL).trim() || DEFAULT_RESEND_API_URL,
  appName: String(process.env.APP_NAME || "Football Booking").trim() || "Football Booking",
  timeoutMs: parsePositiveNumberEnv(process.env.RESEND_TIMEOUT_MS, DEFAULT_CONNECTION_TIMEOUT_MS),
});

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

const isGmailSmtpConfig = (config: SmtpRuntimeConfig) =>
  String(config.service || "").trim().toLowerCase() === "gmail"
  || String(config.host || "").trim().toLowerCase() === DEFAULT_SMTP_HOST;

const hasSmtpConfig = () => {
  const config = readSmtpConfig();
  return Boolean(config.user && config.pass);
};

const hasResendConfig = () => {
  const config = readResendConfig();
  return Boolean(config.apiKey && config.from);
};

const isSmtpConnectionFailure = (error: unknown) => {
  const mailError = extractMailError(error);
  const combinedMessage = [mailError.message, mailError.response].filter(Boolean).join(" ");

  return (
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
  );
};

export const isSmtpConfigured = () => {
  return hasSmtpConfig() || hasResendConfig();
};

export const getSmtpMissingConfigMessage = () =>
  "Mail provider is not configured. Set SMTP_USER/SMTP_PASS or RESEND_API_KEY/RESEND_FROM in environment variables.";

export const getSmtpSendFailureMessage = (error: unknown) => {
  if (!isSmtpConfigured()) {
    return getSmtpMissingConfigMessage();
  }

  const mailError = extractMailError(error);
  const combinedMessage = [mailError.message, mailError.response].filter(Boolean).join(" ");

  if (
    hasResendConfig()
    && messageContains(combinedMessage, [
      "resend api error",
      "resend",
      "invalid api key",
      "unauthorized",
      "forbidden",
      "domain is not verified",
    ])
  ) {
    return "Can not send OTP email via Resend API. Check RESEND_API_KEY and RESEND_FROM.";
  }

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
    if (hasResendConfig() && !hasSmtpConfig()) {
      return "Can not send OTP email via Resend API. Check RESEND_API_KEY, RESEND_FROM, and outbound HTTPS access on hosting.";
    }

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
  const resendConfig = readResendConfig();
  const mailError = extractMailError(error);

  console.error("[OTP][SMTP] Send failed", {
    ...context,
    smtpConfigured: hasSmtpConfig(),
    resendConfigured: hasResendConfig(),
    resendFrom: resendConfig.from || undefined,
    resendApiUrl: resendConfig.apiUrl || undefined,
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

const createTransporterForConfig = async (
  config: SmtpRuntimeConfig,
  { useCache = false }: { useCache?: boolean } = {},
) => {
  if (!config.user || !config.pass) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  const resolvedHost = await resolveSmtpHost(config);
  const cacheKey = `${getTransporterCacheKey(config)}|${resolvedHost.connectionHost}`;

  if (useCache && transporter && transporterCacheKey === cacheKey) {
    return {
      transporter,
      config,
    };
  }

  const nextTransporter = nodemailer.createTransport({
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

  if (useCache) {
    transporterCacheKey = cacheKey;
    transporter = nextTransporter;
  }

  return {
    transporter: nextTransporter,
    config,
  };
};

const getTransporter = async () => createTransporterForConfig(readSmtpConfig(), { useCache: true });

const buildGmailSslFallbackConfig = (config: SmtpRuntimeConfig): SmtpRuntimeConfig => ({
  ...config,
  port: 465,
  secure: true,
  requireTls: false,
});

const postJsonOverHttps = (
  urlValue: string,
  payload: Record<string, any>,
  headers: Record<string, string>,
  timeoutMs: number,
) =>
  new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const requestUrl = new URL(urlValue);
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        protocol: requestUrl.protocol,
        hostname: requestUrl.hostname,
        port: requestUrl.port || 443,
        path: `${requestUrl.pathname}${requestUrl.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body).toString(),
          ...headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          resolve({
            statusCode: Number(response.statusCode || 0),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Connection timeout"));
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });

const sendOtpEmailViaResend = async ({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) => {
  const config = readResendConfig();

  if (!config.apiKey || !config.from) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  const response = await postJsonOverHttps(
    config.apiUrl,
    {
      from: config.from,
      to: [to],
      subject,
      text,
      html,
      ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
    },
    config.timeoutMs,
  );

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response;
  }

  throw new Error(`Resend API error (${response.statusCode}): ${response.body || "unknown error"}`);
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

  const subject = getOtpSubjectByPurpose(purpose);
  const expiresLabel = Math.max(Number(expiresInMinutes) || 0, 1);
  const text = `Ma OTP cua ban la: ${normalizedOtp}. Ma co hieu luc trong ${expiresLabel} phut.`;
  const resendConfig = readResendConfig();
  const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">${resendConfig.appName}</h2>
        <p>Ma OTP cua ban la:</p>
        <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 8px 0 12px;">
          ${normalizedOtp}
        </p>
        <p>Ma co hieu luc trong ${expiresLabel} phut.</p>
      </div>
    `;

  if (hasResendConfig()) {
    return sendOtpEmailViaResend({
      to: normalizedEmail,
      subject,
      text,
      html,
    });
  }

  const { transporter: emailTransporter, config } = await getTransporter();
  const mailOptions = {
    from: config.from ? `"${config.appName}" <${config.from}>` : config.user,
    to: normalizedEmail,
    subject,
    text,
    html,
  };

  try {
    return await emailTransporter.sendMail(mailOptions);
  } catch (error) {
    if (
      !isGmailSmtpConfig(config)
      || config.secure
      || config.port === 465
      || !isSmtpConnectionFailure(error)
    ) {
      throw error;
    }

    const fallbackConfig = buildGmailSslFallbackConfig(config);
    console.warn("[OTP][SMTP] Retrying Gmail with implicit TLS", {
      host: fallbackConfig.host,
      port: fallbackConfig.port,
      secure: fallbackConfig.secure,
      addressFamily: fallbackConfig.addressFamily,
    });

    const { transporter: fallbackTransporter } = await createTransporterForConfig(fallbackConfig);
    return fallbackTransporter.sendMail(mailOptions);
  }
};
