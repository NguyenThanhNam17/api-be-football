import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type ITimeSlot = BaseDocument & {
  startTime: string;
  endTime: string;
  label?: string;
  isDeleted?: boolean;
};

const timeSlotSchema = new mongoose.Schema(
  {
    startTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/, // HH:mm
    },

    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):([0-5]\d)$/,
    },

    label: {
      type: String,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// ✅ auto validate + generate label
timeSlotSchema.pre("save", async function () {
  const start = this.startTime;
  const end = this.endTime;

  const startNum = Number(start.replace(":", ""));
  const endNum = Number(end.replace(":", ""));

  if (startNum >= endNum) {
    throw new Error("endTime phải lớn hơn startTime");
  }

  this.label = `${start} - ${end}`;
});
// chống trùng
timeSlotSchema.index(
  { startTime: 1, endTime: 1 },
  {
    unique: true,
    partialFilterExpression: { isDeleted: false },
  }
);

const TimeSlotModel = mongoose.model<ITimeSlot>("TimeSlot", timeSlotSchema);

export { TimeSlotModel };
