import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { TimeSlotModel } from "../models/TimeSlot/timeSlot.model";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const mongoURI = process.env.MONGO_URI || "";

async function seedTimeSlot() {
  await mongoose.connect(mongoURI);
  console.log("Connected MongoDB");

  // ❌ tránh seed trùng
  const existed = await TimeSlotModel.countDocuments();
  if (existed > 0) {
    console.log("Đã có dữ liệu, không seed lại");
    process.exit();
  }

  const slots = [];

  for (let i = 0; i < 24 * 60; i += 30) {
    const startHour = Math.floor(i / 60);
    const startMinute = i % 60;

    const endTotal = i + 30;
    let endHour = Math.floor(endTotal / 60);
    let endMinute = endTotal % 60;

    // convert 24:00 -> 00:00
    if (endHour === 24) {
      endHour = 0;
    }

    const start = `${startHour.toString().padStart(2, "0")}:${startMinute
      .toString()
      .padStart(2, "0")}`;

    const end = `${endHour.toString().padStart(2, "0")}:${endMinute
      .toString()
      .padStart(2, "0")}`;

    slots.push({
      startTime: start,
      endTime: end,
    });
  }

  await TimeSlotModel.insertMany(slots);

  console.log("Seed time slots 24h (30 phút) thành công");

  process.exit();
}

seedTimeSlot();
