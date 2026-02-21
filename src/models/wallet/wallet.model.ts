import mongoose, { Schema } from "mongoose";

export type IWallet = {
  userId?: string;
  balance?: number;
  passCode?: string;
};

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: { type: Number, default: 0 },
    passCode: { type: String },
  },
  { timestamps: true },
);

const WalletModel = mongoose.model<IWallet>("Wallet", walletSchema);
export { WalletModel };
