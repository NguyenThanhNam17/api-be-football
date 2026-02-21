import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type ICategory = BaseDocument & {
  name?: string;
  description?: string;
  slug?: string;
  image?: string;
};

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    slug: { type: String, unique: true },
    image: { type: String },
  },
  { timestamps: true },
);

const CategoryModel = mongoose.model<ICategory>("Category", categorySchema);
export { CategoryModel };
