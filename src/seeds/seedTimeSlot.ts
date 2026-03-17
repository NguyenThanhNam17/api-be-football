import mongoose from "mongoose";
import { TimeSlotModel } from "../models/TimeSlot/timeSlot.model";
import dotenv from "dotenv";


dotenv.config();

const mongoURI = process.env.MONGO_URI || "";

const generateTimeSlots = () => {
  const slots = [];

  let startHour = 6;
  let startMinute = 0;

  const endHour = 23;

  while (startHour < endHour) {
    const start = `${String(startHour).padStart(2, "0")}:${String(
      startMinute,
    ).padStart(2, "0")}`;

    let endMinute = startMinute + 30;
    let endHourTemp = startHour;

    if (endMinute >= 60) {
      endMinute = 0;
      endHourTemp += 1;
    }

    const end = `${String(endHourTemp).padStart(2, "0")}:${String(
      endMinute,
    ).padStart(2, "0")}`;

    slots.push({
      startTime: start,
      endTime: end,
    });

    startMinute += 30;

    if (startMinute >= 60) {
      startMinute = 0;
      startHour += 1;
    }
  }

  return slots;
};

const seedTimeSlots = async () => {
  try {
    await mongoose.connect(mongoURI);

    console.log("Connected MongoDB");

    await TimeSlotModel.deleteMany({});

    const slots = generateTimeSlots();

    await TimeSlotModel.insertMany(slots);

    console.log("Seeded TimeSlots:", slots.length);

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};

seedTimeSlots();