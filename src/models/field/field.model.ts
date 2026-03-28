import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { FieldStatusEnum, TypeFieldEnum } from "../../constants/model.const";

export type IField = BaseDocument & {
  name?: string;
  slug?: string;
  address?: string;
  district?: string;
  rating?: number;
  coverImage?: string;
  article?: string;
  images?: string[];
  ownerUserId?: Schema.Types.ObjectId;
  ownerFullName?: string;
  managedByAdmin?: boolean;
  status?: FieldStatusEnum;
  isDeleted?: boolean;
  rejectReason?: string;
  type?: TypeFieldEnum;
  openHours?: string;
  pricePerHour?: number;
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

    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
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

    isDeleted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: Object.values(FieldStatusEnum),
      default: FieldStatusEnum.PENDING,
    },
    rejectReason: {
      type: String,
    },
   type: {
  type: String,
  enum: Object.values(TypeFieldEnum), 
},

    openHours: {
      type: String,
    },

    pricePerHour: {
      type: Number,
      min: 0,
    },

  },
  { timestamps: true },
);

const FieldModel = mongoose.model<IField>("Field", fieldSchema);
export { FieldModel };
