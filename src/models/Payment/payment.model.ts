import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import {
  PaymentMethodEnum,
  PaymentStatusEnum,
} from "../../constants/model.const";

export type IPayment = BaseDocument & {
  booking: mongoose.Types.ObjectId;
  amount: number;
  method: string;
  status: string;
  transactionId: string;
  description?: string;
  isActive?: boolean;
};

const paymentSchema = new mongoose.Schema(
  {
    booking: { 
      type: Schema.Types.ObjectId, 
      ref: "Booking", 
      required: true,
      index: true
    },
    amount: { 
      type: Number, 
      required: true,
      min: 0
    },
    method: {
      type: String,
      enum: Object.values(PaymentMethodEnum),
      required: true,
    },
    status: { 
      type: String, 
      enum: Object.values(PaymentStatusEnum),
      default: PaymentStatusEnum.PENDING
    },
    transactionId: { 
      type: String, 
      required: true,
      unique: true
    },
    description: { type: String },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

paymentSchema.index({ transactionId: 1 });

const PaymentModel = mongoose.model<IPayment>("Payment", paymentSchema);
export { PaymentModel };