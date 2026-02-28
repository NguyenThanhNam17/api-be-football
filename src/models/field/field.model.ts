import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { TypeFieldEnum } from "../../constants/model.const";

export type IField = BaseDocument & {
  name: string;
  type: string;
  pricePerHour: number;
  location?: string;
  images?: string[];
  description?: string;
  isActive?: boolean;
  slug?: string;
  isDeleted?: boolean;
};

const fieldSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { 
      type: String, 
      enum: Object.values(TypeFieldEnum), 
      required: true 
    },
    pricePerHour: { 
      type: Number, 
      required: true,
      min: 0
    },
    location: { type: String, trim: true },
    images: { type: [String], default: [] },
    description: { type: String },
    slug: { type: String, unique: true },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

fieldSchema.index({ slug: 1 });

const FieldModel = mongoose.model<IField>("Field", fieldSchema);
export { FieldModel };