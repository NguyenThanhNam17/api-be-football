import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IBooking = BaseDocument & {
  userId: Schema.Types.ObjectId;
  fieldId: Schema.Types.ObjectId;
  subFieldId: Schema.Types.ObjectId;
  timeSlotId: Schema.Types.ObjectId;

  date: Date;
  phone: string;
  note?: string;
  totalPrice: number;
  depositAmount?: number;
  remainingAmount?: number;
  status: string;
  depositStatus?: string;
  depositMethod?: string;
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
      enum: ["pending", "confirmed", "playing", "completed", "cancelled"],
      default: "pending",
    },

    depositStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
    },

    depositMethod: {
      type: String,
    },

    note: {
      type: String,
      trim: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

bookingSchema.index(
  { subFieldId: 1, date: 1, timeSlotId: 1 },
  { unique: true },
);

const BookingModel = mongoose.model<IBooking>("Booking", bookingSchema);
export { BookingModel };
