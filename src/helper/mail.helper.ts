import nodemailer from "nodemailer";
import dns from "node:dns";
import https from "node:https";

const DEFAULT_SMTP_HOST = "smtp.gmail.com";
const DEFAULT_SMTP_PORT = 587;
const DEFAULT_CONNECTION_TIMEOUT_MS = 15000;
const DEFAULT_GREETING_TIMEOUT_MS = 10000;
const DEFAULT_SOCKET_TIMEOUT_MS = 20000;
const DEFAULT_RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_SENDGRID_API_URL = "https://api.sendgrid.com/v3/mail/send";

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

type SendGridRuntimeConfig = {
  apiKey: string;
  from: string;
  replyTo: string;
  apiUrl: string;
  appName: string;
  timeoutMs: number;
};

type MailProvider = "AUTO" | "SMTP" | "RESEND" | "SENDGRID";
type MailProviderReadiness = {
  provider: Exclude<MailProvider, "AUTO">;
  verifiedAt: number;
};

type MailProviderVerificationCache = {
  key: string;
  verifiedAt: number;
  error?: MailErrorLike;
};

let transporter: nodemailer.Transporter | null = null;
let transporterCacheKey = "";
let mailProviderReadiness: MailProviderReadiness | null = null;
let smtpVerificationCache: MailProviderVerificationCache | null = null;

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

const readSendGridConfig = (): SendGridRuntimeConfig => ({
  apiKey: String(process.env.SENDGRID_API_KEY || "").trim(),
  from: String(
    process.env.SENDGRID_FROM
    || process.env.SMTP_FROM
    || process.env.SMTP_USER
    || "",
  ).trim(),
  replyTo: String(process.env.SENDGRID_REPLY_TO || "").trim(),
  apiUrl: String(process.env.SENDGRID_API_URL || DEFAULT_SENDGRID_API_URL).trim() || DEFAULT_SENDGRID_API_URL,
  appName: String(process.env.APP_NAME || "Football Booking").trim() || "Football Booking",
  timeoutMs: parsePositiveNumberEnv(process.env.SENDGRID_TIMEOUT_MS, DEFAULT_CONNECTION_TIMEOUT_MS),
});

const readMailProviderPreference = (): MailProvider => {
  const normalizedValue = String(process.env.MAIL_PROVIDER || "AUTO").trim().toUpperCase();

  if (normalizedValue === "SMTP" || normalizedValue === "RESEND" || normalizedValue === "SENDGRID") {
    return normalizedValue;
  }

  return "AUTO";
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

const hasSendGridConfig = () => {
  const config = readSendGridConfig();
  return Boolean(config.apiKey && config.from);
};

const getMailVerificationTtlMs = () =>
  parsePositiveNumberEnv(process.env.MAIL_VERIFY_CACHE_MS, 60_000);

const resolveActiveMailProvider = (): Exclude<MailProvider, "AUTO"> | "" => {
  const providerPreference = readMailProviderPreference();
  const smtpConfigured = hasSmtpConfig();
  const resendConfigured = hasResendConfig();
  const sendGridConfigured = hasSendGridConfig();

  if (providerPreference === "SMTP") {
    return smtpConfigured ? "SMTP" : "";
  }

  if (providerPreference === "RESEND") {
    return resendConfigured ? "RESEND" : "";
  }

  if (providerPreference === "SENDGRID") {
    return sendGridConfigured ? "SENDGRID" : "";
  }

  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" && resendConfigured) {
    return "RESEND";
  }

  if (String(process.env.NODE_ENV || "").trim().toLowerCase() === "production" && sendGridConfigured) {
    return "SENDGRID";
  }

  if (smtpConfigured) {
    return "SMTP";
  }

  if (resendConfigured) {
    return "RESEND";
  }

  if (sendGridConfigured) {
    return "SENDGRID";
  }

  return "";
};

const createMailProviderError = (
  message: string,
  {
    code = "",
    command = "",
    response = "",
  }: {
    code?: string;
    command?: string;
    response?: string;
  } = {},
) => {
  const error = new Error(String(message || "").trim()) as Error & MailErrorLike;
  error.code = String(code || "").trim().toUpperCase() || undefined;
  error.command = String(command || "").trim() || undefined;
  error.response = String(response || "").trim() || undefined;
  return error;
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
  return Boolean(resolveActiveMailProvider());
};

export const getActiveMailProvider = () => resolveActiveMailProvider();

export const getSmtpMissingConfigMessage = () => {
  const providerPreference = readMailProviderPreference();

  if (providerPreference === "SMTP") {
    return "Chua cau hinh SMTP. Hay set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS va SMTP_FROM tren server.";
  }

  if (providerPreference === "RESEND") {
    return "Chua cau hinh Resend. Hay set RESEND_API_KEY va RESEND_FROM tren server.";
  }

  if (providerPreference === "SENDGRID") {
    return "Chua cau hinh SendGrid. Hay set SENDGRID_API_KEY va SENDGRID_FROM tren server.";
  }

  return "Chua cau hinh dich vu gui email. Local nen dung SMTP, con production/web nen dung Resend hoac SendGrid voi sender da verify.";
};

export const getSmtpSendFailureMessage = (error: unknown) => {
  if (!isSmtpConfigured()) {
    return getSmtpMissingConfigMessage();
  }

  const activeProvider = resolveActiveMailProvider();
  const smtpConfig = readSmtpConfig();
  const mailError = extractMailError(error);
  const combinedMessage = [mailError.message, mailError.response].filter(Boolean).join(" ");

  if (
    activeProvider === "RESEND"
    && messageContains(combinedMessage, [
      "resend api error",
      "resend",
      "invalid api key",
      "unauthorized",
      "forbidden",
      "domain is not verified",
    ])
  ) {
    if (messageContains(combinedMessage, ["api key is invalid", "unauthorized"])) {
      return "RESEND_API_KEY khong hop le. Hay tao API key moi tren Resend va cap nhat lai tren server.";
    }

    if (messageContains(combinedMessage, ["you can only send testing emails to your own email address"])) {
      return "Resend dang o che do test. Ban chi gui duoc email toi dia chi email cua tai khoan Resend. Hay verify domain tren Resend va doi RESEND_FROM sang email thuoc domain da verify.";
    }

    if (messageContains(combinedMessage, ["verify a domain", "domain is not verified"])) {
      return "Domain gui mail tren Resend chua duoc verify. Hay verify domain trong Resend va dat RESEND_FROM bang email thuoc domain do.";
    }

    return "Khong the gui OTP qua Resend. Hay kiem tra RESEND_API_KEY, RESEND_FROM va cau hinh domain tren Resend.";
  }

  if (
    activeProvider === "SENDGRID"
    && messageContains(combinedMessage, [
      "sendgrid",
      "authorization grant is invalid",
      "permission denied",
      "api key",
      "forbidden",
      "sender identity",
      "from address does not match a verified sender identity",
      "unauthorized",
    ])
  ) {
    if (messageContains(combinedMessage, ["authorization grant is invalid", "api key", "unauthorized"])) {
      return "SENDGRID_API_KEY khong hop le. Hay tao API key moi tren SendGrid va cap nhat lai tren server.";
    }

    if (messageContains(combinedMessage, ["verified sender identity", "sender identity"])) {
      return "SENDGRID_FROM chua duoc verify. Hay verify Single Sender hoac Domain Authentication trong SendGrid roi dat SENDGRID_FROM bang email da verify.";
    }

    return "Khong the gui OTP qua SendGrid. Hay kiem tra SENDGRID_API_KEY, SENDGRID_FROM va sender verification trong SendGrid.";
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
    return "Dang nhap SMTP that bai. Hay kiem tra SMTP_USER va SMTP_PASS. Neu dung Gmail, hay dung App Password.";
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
    if (activeProvider === "RESEND") {
      return "Khong the ket noi Resend API. Hay kiem tra RESEND_API_KEY, RESEND_FROM va ket noi HTTPS outbound tren hosting.";
    }

    if (activeProvider === "SENDGRID") {
      return "Khong the ket noi SendGrid API. Hay kiem tra SENDGRID_API_KEY, SENDGRID_FROM va ket noi HTTPS outbound tren hosting.";
    }

    if (isGmailSmtpConfig(smtpConfig)) {
      return "Khong the ket noi Gmail SMTP tu server. Neu local gui duoc nhung web bi timeout, hosting dang chan hoac khong on dinh voi outbound Gmail SMTP. Hay doi sang SMTP provider nhu Brevo, Mailgun hoac SendGrid.";
    }

    return "Khong the ket noi SMTP server. Hay kiem tra SMTP_HOST, SMTP_PORT, SMTP_SECURE va outbound network access tren hosting.";
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
    return "Ket noi TLS toi SMTP that bai. Hay kiem tra SMTP_SECURE va TLS settings.";
  }

  return "Khong the gui OTP email. Hay kiem tra cau hinh mail tren server.";
};

export const logSmtpSendFailure = (
  error: unknown,
  context: Record<string, string | number | boolean | undefined> = {},
) => {
  const config = readSmtpConfig();
  const resendConfig = readResendConfig();
  const sendGridConfig = readSendGridConfig();
  const providerPreference = readMailProviderPreference();
  const activeProvider = resolveActiveMailProvider();
  const mailError = extractMailError(error);

  console.error("[OTP][MAIL] Send failed", {
    ...context,
    mailProviderPreference: providerPreference,
    activeMailProvider: activeProvider || undefined,
    smtpConfigured: hasSmtpConfig(),
    resendConfigured: hasResendConfig(),
    sendGridConfigured: hasSendGridConfig(),
    resendFrom: resendConfig.from || undefined,
    resendApiUrl: resendConfig.apiUrl || undefined,
    sendGridFrom: sendGridConfig.from || undefined,
    sendGridApiUrl: sendGridConfig.apiUrl || undefined,
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
    console.warn("[OTP][MAIL] Host lookup fallback", {
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

  throw createMailProviderError(
    `Resend API error (${response.statusCode}): ${response.body || "unknown error"}`,
    {
      code: `RESEND_${response.statusCode}`,
      command: "RESEND",
      response: response.body || "",
    },
  );
};

const sendOtpEmailViaSendGrid = async ({
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
  const config = readSendGridConfig();

  if (!config.apiKey || !config.from) {
    throw new Error(getSmtpMissingConfigMessage());
  }

  const response = await postJsonOverHttps(
    config.apiUrl,
    {
      personalizations: [
        {
          to: [{ email: to }],
          subject,
        },
      ],
      from: {
        email: config.from,
        name: config.appName,
      },
      content: [
        {
          type: "text/plain",
          value: text,
        },
        {
          type: "text/html",
          value: html,
        },
      ],
      ...(config.replyTo
        ? {
            reply_to: {
              email: config.replyTo,
            },
          }
        : {}),
    },
    {
      Authorization: `Bearer ${config.apiKey}`,
    },
    config.timeoutMs,
  );

  if (response.statusCode >= 200 && response.statusCode < 300) {
    return response;
  }

  throw createMailProviderError(
    `SendGrid API error (${response.statusCode}): ${response.body || "unknown error"}`,
    {
      code: `SENDGRID_${response.statusCode}`,
      command: "SENDGRID",
      response: response.body || "",
    },
  );
};

const verifySmtpTransport = async ({
  force = false,
}: {
  force?: boolean;
} = {}) => {
  const config = readSmtpConfig();
  const ttlMs = getMailVerificationTtlMs();
  const cacheKey = getTransporterCacheKey(config);

  if (
    !force
    && smtpVerificationCache
    && smtpVerificationCache.key === cacheKey
    && Date.now() - smtpVerificationCache.verifiedAt < ttlMs
  ) {
    if (smtpVerificationCache.error) {
      throw createMailProviderError(
        smtpVerificationCache.error.message || "SMTP verification failed.",
        {
          code: smtpVerificationCache.error.code,
          command: smtpVerificationCache.error.command,
          response: smtpVerificationCache.error.response,
        },
      );
    }

    return;
  }

  try {
    const { transporter: smtpTransporter } = await getTransporter();
    await smtpTransporter.verify();
    smtpVerificationCache = {
      key: cacheKey,
      verifiedAt: Date.now(),
    };
    return;
  } catch (error) {
    if (
      isGmailSmtpConfig(config)
      && !config.secure
      && config.port !== 465
      && isSmtpConnectionFailure(error)
    ) {
      const fallbackConfig = buildGmailSslFallbackConfig(config);
      console.warn("[OTP][MAIL] Verifying Gmail with implicit TLS fallback", {
        host: fallbackConfig.host,
        port: fallbackConfig.port,
        secure: fallbackConfig.secure,
        addressFamily: fallbackConfig.addressFamily,
      });

      try {
        const { transporter: fallbackTransporter } = await createTransporterForConfig(fallbackConfig, {
          useCache: true,
        });
        await fallbackTransporter.verify();
        smtpVerificationCache = {
          key: cacheKey,
          verifiedAt: Date.now(),
        };
        return;
      } catch (fallbackError) {
        const fallbackMailError = extractMailError(fallbackError);
        smtpVerificationCache = {
          key: cacheKey,
          verifiedAt: Date.now(),
          error: fallbackMailError,
        };
        throw fallbackError;
      }
    }

    const mailError = extractMailError(error);
    smtpVerificationCache = {
      key: cacheKey,
      verifiedAt: Date.now(),
      error: mailError,
    };
    throw error;
  }
};

export const ensureMailProviderReady = async ({
  force = false,
}: {
  force?: boolean;
} = {}) => {
  const activeProvider = resolveActiveMailProvider();

  if (!activeProvider) {
    throw createMailProviderError(getSmtpMissingConfigMessage());
  }

  if (
    !force
    && mailProviderReadiness
    && mailProviderReadiness.provider === activeProvider
    && Date.now() - mailProviderReadiness.verifiedAt < getMailVerificationTtlMs()
  ) {
    return activeProvider;
  }

  if (activeProvider === "SMTP") {
    await verifySmtpTransport({ force });
  }

  mailProviderReadiness = {
    provider: activeProvider,
    verifiedAt: Date.now(),
  };

  return activeProvider;
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
  const sendGridConfig = readSendGridConfig();
  const activeProvider = resolveActiveMailProvider();
  const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.5;">
        <h2 style="margin: 0 0 12px;">${resendConfig.appName || sendGridConfig.appName}</h2>
        <p>Ma OTP cua ban la:</p>
        <p style="font-size: 24px; font-weight: 700; letter-spacing: 2px; margin: 8px 0 12px;">
          ${normalizedOtp}
        </p>
        <p>Ma co hieu luc trong ${expiresLabel} phut.</p>
      </div>
    `;

  if (activeProvider === "RESEND") {
    return sendOtpEmailViaResend({
      to: normalizedEmail,
      subject,
      text,
      html,
    });
  }

  if (activeProvider === "SENDGRID") {
    return sendOtpEmailViaSendGrid({
      to: normalizedEmail,
      subject,
      text,
      html,
    });
  }

  if (activeProvider !== "SMTP") {
    throw new Error(getSmtpMissingConfigMessage());
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
    console.warn("[OTP][MAIL] Retrying Gmail with implicit TLS", {
      host: fallbackConfig.host,
      port: fallbackConfig.port,
      secure: fallbackConfig.secure,
      addressFamily: fallbackConfig.addressFamily,
    });

    const { transporter: fallbackTransporter } = await createTransporterForConfig(fallbackConfig);
    return fallbackTransporter.sendMail(mailOptions);
  }
};
