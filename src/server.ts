import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config();

// Load app after env is initialized so helpers that read process.env at module load
// time (for example SMTP config) get correct values.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require("./app").default;

const mongoURI = process.env.MONGO_URI || "";
const PORT = process.env.PORT || 5555;

let isMongoConnected = false;

async function connectMongoDB() {
  await mongoose.connect(mongoURI);
  console.log("Connected to MongoDB");
  isMongoConnected = true;
}

app.locals.isMongoConnected = () => isMongoConnected;
mongoose.connection.on("disconnected", () => {
  isMongoConnected = false;
  console.warn("MongoDB disconnected");
});

mongoose.connection.on("connected", () => {
  isMongoConnected = true;
});

mongoose.connection.on("error", (error) => {
  isMongoConnected = false;
  console.error("MongoDB connection error", error);
});

async function startServer() {
  if (!mongoURI) {
    throw new Error("MONGO_URI is required");
  }

  await connectMongoDB();

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  isMongoConnected = false;
  console.error("Failed to start server", error);
  process.exit(1);
});
