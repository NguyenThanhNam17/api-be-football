import mongoose, { Schema, Types } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IQRCode = BaseDocument & {
  paymentId: Types.ObjectId;
  qrImage: string;
  qrText?: string;
  payUrl?: string;
  deeplink?: string;
  expiredAt?: Date;
};

const qrSchema = new mongoose.Schema(
  {
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      required: true
    },

    qrImage: {
      type: String,
      required: true
    },

    qrText: {
      type: String,
    },

    payUrl: {
      type: String,
    },

    deeplink: {
      type: String,
    },

    expiredAt: {
      type: Date
    }
  },
  { timestamps: true }
);

const QRCodeModel = mongoose.model<IQRCode>("QRCode", qrSchema);
export { QRCodeModel };
