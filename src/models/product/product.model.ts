import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IProduct = BaseDocument & {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  stock?: number;
  slug?: string;
  image?: string[];
  salePrice?: number;
  isAvailable?: boolean;
  tags?: string[];
};

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    category: { type: String },
    stock: { type: Number, default: 0 },
    slug: { type: String},
    image: { type: [String], default: [] },
    salePrice: { type: Number },
    isAvailable: { type: Boolean, default: true },
    tags: { type: [String], default: [] },
  },
  { timestamps: true },
);

const ProductModel = mongoose.model<IProduct>("Product", productSchema);
export { ProductModel };
