import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type ITimeSlot = BaseDocument & {
  startTime: string;
  endTime: string;
  isActive?: boolean;
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

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const TimeSlotModel = mongoose.model<ITimeSlot>("TimeSlot", timeSlotSchema);
export { TimeSlotModel };
