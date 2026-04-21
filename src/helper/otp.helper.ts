import crypto from "crypto";
import { OtpCodeModel } from "../models/otp/otp.model";

const OTP_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_SECRET = String(process.env.OTP_SECRET || process.env.SECRET || "otp-secret").trim();
const OTP_EXPIRES_MINUTES = Math.max(Number(process.env.OTP_EXPIRES_MINUTES || 5), 1);
const OTP_RESEND_SECONDS = Math.max(Number(process.env.OTP_RESEND_SECONDS || 60), 0);
const OTP_MAX_ATTEMPTS = Math.max(Number(process.env.OTP_MAX_ATTEMPTS || 5), 1);
const OTP_CODE_LENGTH = Math.min(Math.max(Number(process.env.OTP_CODE_LENGTH || 6), 4), 8);
const OTP_CIPHER_ALGORITHM = "aes-256-gcm";
const OTP_ENCRYPTION_KEY = crypto
  .createHash("sha256")
  .update(`otp-cipher|${OTP_SECRET}`)
  .digest();

type IssuedOtpPayload = {
  otpId: string;
  otp: string;
  expiresAt: Date;
  expiresInMinutes: number;
  purpose: string;
  email: string;
  resendAvailableAt: Date;
  shouldInvalidateOnSendFailure: boolean;
  reusedActiveOtp: boolean;
};

const normalizeOtpEmail = (value: string) => String(value || "").trim().toLowerCase();

const normalizeOtpPurpose = (value: string) =>
  String(value || "auth")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 40) || "auth";

const createOtpCode = (length: number = OTP_CODE_LENGTH) => {
  const size = Math.max(Number(length) || OTP_CODE_LENGTH, 4);
  let otp = "";

  for (let index = 0; index < size; index += 1) {
    otp += crypto.randomInt(0, 10).toString();
  }

  return otp;
};

const buildOtpHash = (email: string, purpose: string, otp: string) =>
  crypto
    .createHash("sha256")
    .update(`${normalizeOtpEmail(email)}|${normalizeOtpPurpose(purpose)}|${String(otp || "").trim()}|${OTP_SECRET}`)
    .digest("hex");

const encryptOtpCode = (otp: string) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(OTP_CIPHER_ALGORITHM, OTP_ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(otp || "").trim(), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}.${authTag.toString("hex")}.${encrypted.toString("hex")}`;
};

const decryptOtpCode = (value: string) => {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return "";
  }

  const [ivHex, authTagHex, encryptedHex] = normalizedValue.split(".");

  if (!ivHex || !authTagHex || !encryptedHex) {
    return "";
  }

  try {
    const decipher = crypto.createDecipheriv(
      OTP_CIPHER_ALGORITHM,
      OTP_ENCRYPTION_KEY,
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8").trim();
  } catch (_error) {
    return "";
  }
};

const getOtpResendAvailableAt = (dateValue: Date) =>
  new Date(dateValue.getTime() + OTP_RESEND_SECONDS * 1000);

const getOtpExpiresInMinutes = (expiresAt: Date, now: Date) =>
  Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / (60 * 1000)));

export const issueOtpCode = async ({
  email,
  purpose = "auth",
}: {
  email: string;
  purpose?: string;
}): Promise<IssuedOtpPayload> => {
  const normalizedEmail = normalizeOtpEmail(email);
  const normalizedPurpose = normalizeOtpPurpose(purpose);
  const now = new Date();

  if (!OTP_EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error("Invalid email format.");
  }

  const latestActiveOtp = await OtpCodeModel.findOne({
    email: normalizedEmail,
    purpose: normalizedPurpose,
    isUsed: false,
    expiresAt: { $gt: now },
  }).sort({ lastSentAt: -1, createdAt: -1 });

  if (latestActiveOtp) {
    const reusableOtp = decryptOtpCode(String(latestActiveOtp.codeCipher || "").trim());

    if (reusableOtp) {
      const lastSentAt = latestActiveOtp.lastSentAt || latestActiveOtp.createdAt || now;
      const resendAvailableAt = getOtpResendAvailableAt(lastSentAt);

      if (resendAvailableAt.getTime() > now.getTime()) {
        const remainSeconds = Math.ceil(
          (resendAvailableAt.getTime() - now.getTime()) / 1000,
        );
        throw new Error(`Please wait ${Math.max(remainSeconds, 1)}s before requesting a new OTP.`);
      }

      return {
        otpId: String(latestActiveOtp._id || "").trim(),
        otp: reusableOtp,
        expiresAt: latestActiveOtp.expiresAt,
        expiresInMinutes: getOtpExpiresInMinutes(latestActiveOtp.expiresAt, now),
        purpose: normalizedPurpose,
        email: normalizedEmail,
        resendAvailableAt: getOtpResendAvailableAt(now),
        shouldInvalidateOnSendFailure: false,
        reusedActiveOtp: true,
      };
    }

    latestActiveOtp.isUsed = true;
    latestActiveOtp.expiresAt = now;
    await latestActiveOtp.save();
  }

  const otp = createOtpCode();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRES_MINUTES * 60 * 1000);
  const codeHash = buildOtpHash(normalizedEmail, normalizedPurpose, otp);
  const codeCipher = encryptOtpCode(otp);

  const otpDoc = await OtpCodeModel.create({
    email: normalizedEmail,
    purpose: normalizedPurpose,
    codeHash,
    codeCipher,
    expiresAt,
    attempts: 0,
    isUsed: true,
    lastSentAt: null,
  });

  return {
    otpId: String(otpDoc._id || "").trim(),
    otp,
    expiresAt,
    expiresInMinutes: OTP_EXPIRES_MINUTES,
    purpose: normalizedPurpose,
    email: normalizedEmail,
    resendAvailableAt: getOtpResendAvailableAt(now),
    shouldInvalidateOnSendFailure: true,
    reusedActiveOtp: false,
  };
};

export const activateIssuedOtpCode = async ({
  otpId,
  email,
  purpose = "auth",
}: {
  otpId: string;
  email: string;
  purpose?: string;
}) => {
  const normalizedOtpId = String(otpId || "").trim();
  const normalizedEmail = normalizeOtpEmail(email);
  const normalizedPurpose = normalizeOtpPurpose(purpose);
  const now = new Date();

  if (!normalizedOtpId || !normalizedEmail) {
    return;
  }

  await OtpCodeModel.updateMany(
    {
      _id: { $ne: normalizedOtpId },
      email: normalizedEmail,
      purpose: normalizedPurpose,
      isUsed: false,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        isUsed: true,
        expiresAt: now,
      },
    },
  );

  await OtpCodeModel.updateOne(
    { _id: normalizedOtpId },
    {
      $set: {
        isUsed: false,
        lastSentAt: now,
      },
    },
  );
};

export const invalidateOtpCode = async (otpId: string) => {
  const normalizedOtpId = String(otpId || "").trim();
  if (!normalizedOtpId) {
    return;
  }

  await OtpCodeModel.updateOne(
    { _id: normalizedOtpId },
    {
      $set: {
        isUsed: true,
        expiresAt: new Date(),
      },
    },
  );
};

export const verifyOtpCode = async ({
  email,
  otp,
  purpose = "auth",
}: {
  email: string;
  otp: string;
  purpose?: string;
}) => {
  const normalizedEmail = normalizeOtpEmail(email);
  const normalizedPurpose = normalizeOtpPurpose(purpose);
  const normalizedOtp = String(otp || "").trim();
  const now = new Date();

  if (!OTP_EMAIL_PATTERN.test(normalizedEmail)) {
    return {
      isValid: false,
      message: "Invalid email format.",
    };
  }

  if (!normalizedOtp) {
    return {
      isValid: false,
      message: "OTP is required.",
    };
  }

  const activeOtp = await OtpCodeModel.findOne({
    email: normalizedEmail,
    purpose: normalizedPurpose,
    isUsed: false,
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  if (!activeOtp) {
    return {
      isValid: false,
      message: "OTP does not exist or has expired.",
    };
  }

  if (Number(activeOtp.attempts || 0) >= OTP_MAX_ATTEMPTS) {
    activeOtp.isUsed = true;
    await activeOtp.save();
    return {
      isValid: false,
      message: "OTP has exceeded max attempts.",
    };
  }

  const inputHash = buildOtpHash(normalizedEmail, normalizedPurpose, normalizedOtp);

  if (inputHash !== String(activeOtp.codeHash || "").trim()) {
    const nextAttempts = Number(activeOtp.attempts || 0) + 1;
    activeOtp.attempts = nextAttempts;

    if (nextAttempts >= OTP_MAX_ATTEMPTS) {
      activeOtp.isUsed = true;
    }

    await activeOtp.save();

    return {
      isValid: false,
      message:
        nextAttempts >= OTP_MAX_ATTEMPTS
          ? "OTP has exceeded max attempts."
          : "OTP is not correct.",
    };
  }

  activeOtp.isUsed = true;
  activeOtp.verifiedAt = new Date();
  await activeOtp.save();

  return {
    isValid: true,
    message: "OTP verified successfully.",
  };
};
