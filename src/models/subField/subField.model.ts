import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type ISubField = BaseDocument & {
  fieldId: Schema.Types.ObjectId;
  key: string;
  name: string;
  type: string;
  pricePerHour: number;
  openHours?: string;
  isDeleted?: boolean;
};

const subFieldSchema = new mongoose.Schema(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: "Field",
      required: true,
      index: true
    },
    key: {
      type: String,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    type: {
      type: String
    },
    pricePerHour: {
      type: Number,
      required: true
    },
    openHours: {
      type: String
    },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const SubFieldModel = mongoose.model<ISubField>("SubField", subFieldSchema);
export { SubFieldModel };