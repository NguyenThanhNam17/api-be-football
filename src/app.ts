import express from "express";
import router from "./routers";
import cors from "cors";
import cron from "node-cron";
import { autoCancelBooking } from "./jobs/booking.job";
import { ensureUploadDirectory, UPLOAD_PUBLIC_PATH } from "./helper/upload.helper";


const app = express();
app.locals.isMongoConnected = () => false;
app.set("trust proxy", 1);
const uploadDirectory = ensureUploadDirectory();

app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);


cron.schedule("* * * * *", async () => {
  try {
    const isMongoConnected = Boolean(app.locals.isMongoConnected?.());
    if (!isMongoConnected) {
      return;
    }

    await autoCancelBooking();
  } catch (error) {
    console.error("Booking cleanup cron failed", error);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(UPLOAD_PUBLIC_PATH, express.static(uploadDirectory));


app.get("/", (req, res) => {
  const dbStatus = Boolean(req.app.locals.isMongoConnected?.());
  res.send(`
    <h1>Nguyễn Thành Nam - DH52201080 - D22-TH03</h1>
    <p>Status API: Running </p>
    <ul>
      <li>/api/user/getAllUser</li>
    </ul>

     <p>Database: ${dbStatus ? "Connected " : "Disconnected "}</p>
  `);
});
app.get("/healthz", (req, res) => {
  const dbConnected = Boolean(req.app.locals.isMongoConnected?.());

  return res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? "ok" : "degraded",
    database: dbConnected ? "connected" : "disconnected",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});
app.use("/", router);

export default app;
