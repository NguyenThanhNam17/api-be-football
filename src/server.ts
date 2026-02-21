import dotenv from "dotenv";
import mongoose from "mongoose";
import app from "./app";

dotenv.config();

const mongoURI = process.env.MONGO_URI || "";
const PORT = process.env.PORT || 5555;

async function connectMongoDB() {
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");
}

connectMongoDB();

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

