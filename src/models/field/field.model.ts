import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IField = BaseDocument & {
  name: string;
  slug: string;
  address: string;
  district: string;
  type: string;
  openHours: string;
  pricePerHour: number;
  rating?: number;
  coverImage?: string;
  article?: string;
  images?: string[];
  ownerUserId?: Schema.Types.ObjectId;
  ownerFullName?: string;
  managedByAdmin?: boolean;
  isDeleted?: boolean;
};

const fieldSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
    },
    address: {
      type: String,
      required: true,
    },
    district: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    openHours: {
      type: String,
    },
    pricePerHour: {
      type: Number,
      required: true,
    },
    rating: {
      type: Number,
      default: 0,
    },
    coverImage: {
      type: String,
    },
    article: {
      type: String,
    },
    images: [{ type: String }],
    ownerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    ownerFullName: {
      type: String,
    },
    managedByAdmin: {
      type: Boolean,
      default: false,
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const FieldModel = mongoose.model<IField>("Field", fieldSchema);
export { FieldModel };
