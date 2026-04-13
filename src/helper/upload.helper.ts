import fs from "fs";
import path from "path";

export const UPLOAD_PUBLIC_PATH = "/uploads";
const DEFAULT_UPLOAD_DIR = "uploads";

const normalizeSegment = (value = "") =>
  String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export const getUploadDirectory = () => {
  const configuredUploadDir = String(process.env.UPLOAD_DIR || "").trim();

  if (!configuredUploadDir) {
    return path.resolve(process.cwd(), DEFAULT_UPLOAD_DIR);
  }

  return path.isAbsolute(configuredUploadDir)
    ? configuredUploadDir
    : path.resolve(process.cwd(), configuredUploadDir);
};

export const ensureUploadDirectory = () => {
  const uploadDirectory = getUploadDirectory();

  if (!fs.existsSync(uploadDirectory)) {
    fs.mkdirSync(uploadDirectory, { recursive: true });
  }

  return uploadDirectory;
};

export const buildStoredUploadFileName = (originalName = "") => {
  const normalizedOriginalName = String(originalName || "").trim();
  const extension = normalizeSegment(path.extname(normalizedOriginalName || ""))
    .replace(/^-+/, "");
  const baseName = normalizeSegment(
    path.basename(normalizedOriginalName || "image", path.extname(normalizedOriginalName || ""))
  );

  return `${Date.now()}-${baseName || "image"}${extension ? `.${extension.replace(/^\.+/, "")}` : ""}`;
};

export const getRequestOrigin = (host = "", forwardedProto = "", protocol = "http") => {
  const normalizedHost = String(host || "").split(",")[0].trim();
  const normalizedProto = String(forwardedProto || protocol || "http")
    .split(",")[0]
    .trim()
    .toLowerCase();

  if (!normalizedHost) {
    return "";
  }

  return `${normalizedProto || "http"}://${normalizedHost}`;
};
