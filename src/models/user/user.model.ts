import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IUser = BaseDocument & {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  phone?: string;
  key?: string;
  walletId?: mongoose.Types.ObjectId;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String },
    email: { type: String, unique: true },
    password: { type: String },
    role: { type: String },
    phone: { type: String },
    key: { type: String },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet" },
  },
  { timestamps: true },
);

const UserModel = mongoose.model<IUser>("User", userSchema);
export { UserModel };   
