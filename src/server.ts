import dotenv from "dotenv";
import mongoose from "mongoose";
import app from "./app";
import express from "express";
import path from "path";




dotenv.config();

const mongoURI = process.env.MONGO_URI || "";
const PORT = process.env.PORT || 5555;

let isMongoConnected = false;

async function connectMongoDB() {
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");
  isMongoConnected = true;
}

connectMongoDB();
app.use("/uploads", express.static("uploads"));
app.locals.isMongoConnected = () => isMongoConnected;
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
