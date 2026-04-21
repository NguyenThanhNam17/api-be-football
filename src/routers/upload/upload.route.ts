import { Router, Request, Response } from "express";
import multer, { StorageEngine } from "multer";
import {
  buildStoredUploadFileName,
  ensureUploadDirectory,
  getRequestOrigin,
  UPLOAD_PUBLIC_PATH,
} from "../../helper/upload.helper";

const router = Router();

const storage: StorageEngine = multer.diskStorage({
  destination: function (
    req: Request,
    file: Express.Multer.File,
    cb: Function
  ) {
    cb(null, ensureUploadDirectory());
  },
  filename: function (
    req: Request,
    file: Express.Multer.File,
    cb: Function
  ) {
    const uniqueName = buildStoredUploadFileName(file.originalname);
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

      const origin = getRequestOrigin(
        req.get("x-forwarded-host") || req.get("host") || "",
        req.get("x-forwarded-proto") || "",
        req.protocol
      );
      const url = `${origin}${UPLOAD_PUBLIC_PATH}/${file.filename}`;

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
