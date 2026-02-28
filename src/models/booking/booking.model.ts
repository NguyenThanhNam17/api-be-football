import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { BookingStatusEnum } from "../../constants/model.const";

export type IBooking = BaseDocument & {
  userId: Schema.Types.ObjectId;
  fieldId: Schema.Types.ObjectId;
  timeSlotId: Schema.Types.ObjectId;
  totalPrice: number;
  status: string;
  note?: string;
  isDeleted?: boolean;
};

const bookingSchema = new mongoose.Schema(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true
    },
    fieldId: { 
      type: Schema.Types.ObjectId, 
      ref: "Field", 
      required: true,
      index: true
    },
    timeSlotId: {
      type: Schema.Types.ObjectId,
      ref: "TimeSlot",
      required: true,
    },
    totalPrice: { 
      type: Number, 
      required: true,
      min: 0
    },
    status: {
      type: String,
      enum: Object.values(BookingStatusEnum),
      default: BookingStatusEnum.PENDING,
    },
    note: { type: String, trim: true },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// chống đặt trùng slot
bookingSchema.index(
  { fieldId: 1, timeSlotId: 1 },
  { unique: true }
);

const BookingModel = mongoose.model<IBooking>("Booking", bookingSchema);
export { BookingModel };