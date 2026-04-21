import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IOtpCode = BaseDocument & {
  email: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  isUsed: boolean;
  verifiedAt?: Date | null;
};

const otpCodeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    purpose: {
      type: String,
      required: true,
      default: "auth",
      trim: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    isUsed: {
      type: Boolean,
      default: false,
      index: true,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Auto cleanup expired OTP documents.
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const OtpCodeModel = mongoose.model<IOtpCode>("OtpCode", otpCodeSchema);
export { OtpCodeModel };
