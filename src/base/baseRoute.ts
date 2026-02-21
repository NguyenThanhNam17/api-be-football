import express from "express";
import { resError } from "../helper/resError";
import { ROLES } from "../constants/role.const";

export interface Request extends express.Request {
  tokenInfo?: {
    role_: keyof typeof ROLES;
    _id: string;
    key: string;
    [name: string]: any;
  };
  files: any;
}

export interface Response extends express.Response {}
export interface NextFunction extends express.NextFunction {}

export abstract class BaseRoute {
  router: express.Router;
  constructor() {
    this.router = express.Router();
    this.customRouting();
  }
  abstract customRouting(): void;

  route(
    func: (req: Request, res: Response, next: NextFunction) => Promise<any>,
  ) {
    return (req: Request, res: Response, next: NextFunction) =>
      func
        .bind(this)(req, res, next)
        .catch((error: any) => {
          this.resError(res, error);
        });
  }
  resError(res: Response, error: any) {
    return resError(res, error);
  }
}
