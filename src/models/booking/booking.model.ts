import mongoose, { Schema, Types } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import {
  BookingStatusEnum,
  DepositMethodEnum,
  DepositStatusEnum,
} from "../../constants/model.const";

export type IBooking = BaseDocument & {
  userId: Types.ObjectId;
  fieldId: Types.ObjectId;
  subFieldId: Types.ObjectId;
  timeSlotId: Types.ObjectId;
  date: Date;
  phone: string;
  note?: string;
  totalPrice: number;
  depositAmount?: number;
  remainingAmount?: number;
  status: string;
  depositStatus?: string;
  depositMethod?: string;
  expiredAt?: Date;
  isDeleted?: boolean;
};

const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    fieldId: {
      type: Schema.Types.ObjectId,
      ref: "Field",
      required: true,
      index: true,
    },

    subFieldId: {
      type: Schema.Types.ObjectId,
      ref: "SubField",
      required: true,
      index: true,
    },

    date: {
      type: Date,
      required: true,
      index: true,
    },

    timeSlotId: {
      type: Schema.Types.ObjectId,
      ref: "TimeSlot",
      required: true,
    },

    phone: {
      type: String,
      required: true,
    },

    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    depositAmount: {
      type: Number,
      default: 0,
    },

    remainingAmount: {
      type: Number,
      default: 0,
    },

    status: {
      type: String,
      enum: Object.values(BookingStatusEnum),
      default: BookingStatusEnum.PENDING,
    },

    depositStatus: {
      type: String,
      enum: Object.values(DepositStatusEnum),
      default: DepositStatusEnum.UNPAID,
    },

    depositMethod: {
      type: String,
      enum: Object.values(DepositMethodEnum),
      default: DepositMethodEnum.CASH,
    },

    note: {
      type: String,
      trim: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
    expiredAt: {
      type: Date,
    },
  },
  { timestamps: true },
);

bookingSchema.index(
  { subFieldId: 1, date: 1, timeSlotId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] },
    },
  }
);

const BookingModel = mongoose.model<IBooking>("Booking", bookingSchema);
export { BookingModel };
