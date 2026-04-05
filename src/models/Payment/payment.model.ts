import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import {
  PaymentStatusEnum,
  PaymentMethodEnum,
} from "../../constants/model.const";
import { Types } from "mongoose";

export type IPayment = BaseDocument & {
  bookingId: Types.ObjectId;
  bookingIds?: Types.ObjectId[];
  userId: Types.ObjectId;
  amount: number;
  method: PaymentMethodEnum;
  paymentType?: "DEPOSIT" | "FULL";
  status: PaymentStatusEnum;
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
      index: true,
    },

    bookingIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Booking",
      },
    ],

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    method: {
      type: String,
      enum: Object.values(PaymentMethodEnum),
      default: PaymentMethodEnum.BANK,
    },

    paymentType: {
      type: String,
      enum: ["DEPOSIT", "FULL"],
      default: "DEPOSIT",
    },

    status: {
      type: String,
      enum: Object.values(PaymentStatusEnum),
      default: PaymentStatusEnum.PENDING,
    },

    qrCode: {
      type: String,
    },

    transactionCode: {
      type: String,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ bookingIds: 1 });

const PaymentModel = mongoose.model<IPayment>("Payment", paymentSchema);
export { PaymentModel };
