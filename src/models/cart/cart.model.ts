import mongoose, { Schema } from "mongoose";
import { CartStatusEnum } from "../../constants/model.const";

export interface ICartItem {
  userId?: string;
  productId?: string;
  quantity?: number;
  status?: string;
}

const cartSchema = new mongoose.Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    productId: { type: Schema.Types.ObjectId, ref: "Product"},
    quantity: { type: Number, default: 1 },
    status: { type: String, default: CartStatusEnum.PENDING },
  },
  { timestamps: true },
);

const CartModel = mongoose.model<ICartItem>("Cart", cartSchema);
export { CartModel };
