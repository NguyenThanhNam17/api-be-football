import { Router, Request, Response } from "express";
import multer, { StorageEngine } from "multer";
import fs from "fs";

const router = Router();

const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage: StorageEngine = multer.diskStorage({
  destination: function (
    req: Request,
    file: Express.Multer.File,
    cb: Function
  ) {
    cb(null, "uploads/");
  },
  filename: function (
    req: Request,
    file: Express.Multer.File,
    cb: Function
  ) {
    const uniqueName = Date.now() + "-" + file.originalname;
    cb(null, uniqueName);
  },
});

const upload = multer({ storage });

router.post(
  "/upload/image",
  upload.single("file"),
  (req: Request, res: Response) => {
    try {
      const file = req.file as Express.Multer.File;

      if (!file) {
        return res.status(400).json({
          message: "No file uploaded",
        });
      }

      const url = `${req.protocol}://${req.get("host")}/uploads/${file.filename}`;

      return res.json({
        url,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Upload failed",
      });
    }
  }
);

export default router;