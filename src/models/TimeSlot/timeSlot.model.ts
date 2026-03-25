import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type ITimeSlot = BaseDocument & {
  startTime: string;
  endTime: string;
  label: string;
  isDeleted?: boolean;
};

const timeSlotSchema = new mongoose.Schema(
  {
    startTime: {
      type: String,
      required: true,
    },

    endTime: {
      type: String,
      required: true,
    },

    label: {
      type: String,
      required: true,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

timeSlotSchema.index(
  { startTime: 1, endTime: 1 },
  { unique: true }
);

const TimeSlotModel = mongoose.model<ITimeSlot>(
  "TimeSlot",
  timeSlotSchema
);

export { TimeSlotModel };