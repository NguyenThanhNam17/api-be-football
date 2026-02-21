import { Response } from "express";

export function resError(res: Response, error: any) {
  if (!error || !error.info) {
    res.status(500).json({
      status: 500,
      code: "500",
      message: "Đã có lỗi xảy ra",
    });

    logUnknownError(error);
  } else {
    res
      .status(error.info.status || 500)
      .json(error.info);
  }
}

function logUnknownError(error: unknown) {
  console.log("*** UNKNOWN ERROR ***");
  console.log(error);
  console.log("*********************");
}
