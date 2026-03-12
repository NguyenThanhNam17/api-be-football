import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IUser = BaseDocument & {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: string;
  isDeleted?: boolean;
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ["user", "admin", "owner"],
      default: "user",
    },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const UserModel = mongoose.model<IUser>("User", userSchema);
export { UserModel };
