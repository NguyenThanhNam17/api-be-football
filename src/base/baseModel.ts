import mongoose from "mongoose";

export type BaseDocument = mongoose.Document & {
  createdAt?: Date;
  updatedAt?: Date;
};
