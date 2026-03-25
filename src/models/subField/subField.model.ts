import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { TypeFieldEnum } from "../../constants/model.const";

export type ISubField = BaseDocument & {
  fieldId: Schema.Types.ObjectId;
  key: string;
  name: string;
  type: TypeFieldEnum;
  pricePerHour: number;
  isDeleted?: boolean;
};

const subFieldSchema = new mongoose.Schema(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      ref: "Field",
      required: true,
      index: true,
    },

    key: {
      type: String,
      required: true,
    },

    name: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: Object.values(TypeFieldEnum),
      required: true,
    },

    pricePerHour: {
      type: Number,
      required: true,
      min: 0,
    },

    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);
const SubFieldModel = mongoose.model<ISubField>("SubField", subFieldSchema);
export { SubFieldModel };
