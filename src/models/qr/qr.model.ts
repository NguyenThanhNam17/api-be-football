import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IQRCode = BaseDocument & {
  paymentId: Schema.Types.ObjectId;
  qrImage: string;
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

    expiredAt: {
      type: Date
    }
  },
  { timestamps: true }
);

const QRCodeModel = mongoose.model<IQRCode>("QRCode", qrSchema);
export { QRCodeModel };