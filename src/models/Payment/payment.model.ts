import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IPayment = BaseDocument & {
  bookingId: Schema.Types.ObjectId;
  userId: Schema.Types.ObjectId;
  amount: number;
  method: string;
  status: string;
  qrCode?: string;
  transactionCode?: string;
  isDeleted?: boolean;
};

const paymentSchema = new mongoose.Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    amount: {
      type: Number,
      required: true,
      min: 0
    },

    method: {
      type: String,
      enum: ["bank_transfer", "momo", "cash"],
      default: "bank_transfer"
    },

    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending"
    },

    qrCode: {
      type: String
    },

    transactionCode: {
      type: String
    },

    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const PaymentModel = mongoose.model<IPayment>("Payment", paymentSchema);
export { PaymentModel };