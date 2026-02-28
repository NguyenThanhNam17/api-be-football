import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { HydratedDocument } from "mongoose";

export type ITimeSlot = BaseDocument & {
  field: mongoose.Types.ObjectId;
  startTime: Date;
  endTime: Date;
  price: number;
  isBooked?: boolean;
};

const timeSlotSchema = new mongoose.Schema(
  {
    field: {
      type: Schema.Types.ObjectId,
      ref: "Field",
      required: true,
      index: true,
    },
    startTime: { type: Date, required: true },
    endTime: { type: Date, required: true },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    isBooked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// đảm bảo endTime > startTime

timeSlotSchema.pre("save", async function (this: HydratedDocument<ITimeSlot>) {
  if (this.endTime <= this.startTime) {
    throw new Error("End time must be greater than start time");
  }
});

// chống trùng slot
timeSlotSchema.index({ field: 1, startTime: 1, endTime: 1 }, { unique: true });

const TimeSlotModel = mongoose.model<ITimeSlot>("TimeSlot", timeSlotSchema);
export { TimeSlotModel };
