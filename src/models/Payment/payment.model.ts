import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import {
  PaymentStatusEnum,
  PaymentMethodEnum,
} from "../../constants/model.const";
import { Types } from "mongoose";

export type IPayment = BaseDocument & {
  bookingId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  method: PaymentMethodEnum;
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

const PaymentModel = mongoose.model<IPayment>("Payment", paymentSchema);
export { PaymentModel };