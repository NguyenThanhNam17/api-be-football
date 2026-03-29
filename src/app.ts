import express from "express";
import router from "./routers";
import cors from "cors";
import path from "path";
import cron from "node-cron";
import { autoCancelBooking } from "./jobs/booking.job";


const app = express();

app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
  }),
);


cron.schedule("* * * * *", async () => {
  await autoCancelBooking();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static("uploads"));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));


app.get("/", (req, res) => {
  const dbStatus = req.app.locals.isMongoConnected();
  res.send(`
    <h1>Nguyễn Thành Nam - DH52201080 - D22-TH03</h1>
    <p>Status API: Running </p>
    <ul>
      <li>/api/user/getAllUser</li>
    </ul>

     <p>Database: ${dbStatus ? "Connected " : "Disconnected "}</p>
  `);
});
app.use("/", router);

export default app;
