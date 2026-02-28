import mongoose, { Schema } from "mongoose";
import { BaseDocument } from "../../base/baseModel";
import { ROLES } from "../../constants/role.const";

export type IUser = BaseDocument & {
  name?: string;
  email: string;
  password: string;
  role?: string;
  phone?: string;
  walletId?: mongoose.Types.ObjectId;
  isDeleted?: boolean;
};

const userSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    email: { 
      type: String, 
      required: true,
      unique: true,
      lowercase: true,
      trim: true
    },
    password: { 
      type: String, 
      required: true,
      select: false
    },
    role: { 
      type: String, 
      enum: Object.values(ROLES), 
      default: ROLES.USER 
    },
    phone: { type: String },
    walletId: { type: Schema.Types.ObjectId, ref: "Wallet" },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

const UserModel = mongoose.model<IUser>("User", userSchema);
export { UserModel };