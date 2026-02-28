import mongoose, { Schema } from "mongoose";

export type IWallet = {
  userId: Schema.Types.ObjectId;
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
    balance: { 
      type: Number, 
      default: 0,
      min: 0
    },
    passCode: { 
      type: String,
      select: false
    },
  },
  { timestamps: true }
);

walletSchema.index({ userId: 1 });

const WalletModel = mongoose.model<IWallet>("Wallet", walletSchema);
export { WalletModel };