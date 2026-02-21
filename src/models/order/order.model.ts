import mongoose, { Schema } from "mongoose";
import { OrderStatusEnum } from "../../constants/model.const";

export type IOrder = {
  userId?: string;
  cartId?: string;
  paymentMethod?: string;
  status?: string;
  shippingFee?: number;
  discount?: number;
  totalPrice?: number;
  isPaid?: boolean;
};

const orderSchema = new mongoose.Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User" },
  cartId: { type: Schema.Types.ObjectId, ref: "Cart" },
  shippingFee: { type: Number, default: 0 },
  paymentMethod: { type: String, required: true },
  discount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: Object.values(OrderStatusEnum),
  },
  totalPrice: { type: Number, required: true },
  isPaid: { type: Boolean, default: false },
});

const OrderModel = mongoose.model<IOrder>("Order", orderSchema);
export { OrderModel };
