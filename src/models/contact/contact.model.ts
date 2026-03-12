import mongoose from "mongoose";
import { BaseDocument } from "../../base/baseModel";

export type IContact = BaseDocument & {
  name: string;
  email: string;
  phone?: string;
  message: string;
  isDeleted?: boolean;
};

const contactSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: true,
      trim: true 
    },
    email: { 
      type: String, 
      required: true,
      trim: true 
    },
    phone: { 
      type: String,
      trim: true 
    },
    message: { 
      type: String, 
      required: true 
    },
    isDeleted: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const ContactModel = mongoose.model<IContact>("Contact", contactSchema);
export { ContactModel };