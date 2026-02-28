import { ErrorHelper } from "../../base/error";
import {
  BaseRoute,
  Request,
  Response,
  NextFunction,
} from "../../base/baseRoute";

import { UserModel } from "../../models/user/user.model";

import { ROLES } from "../../constants/role.const";

import { TokenHelper } from "../../helper/token.helper";

import { WalletModel } from "../../models/wallet/wallet.model";


class WalletRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/updateBalanceForAdmin", [this.authentication], this.route(this.updateBalanceForAdmin));

}

 async authentication(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.get("x-token")) {
        throw ErrorHelper.unauthorized();
      }
      const tokenData: any = TokenHelper.decodeToken(req.get("x-token"));
      if ([ROLES.ADMIN, ROLES.CLIENT].includes(tokenData.role_)) {
        const user: any = await UserModel.findById(tokenData._id);
        if (!user) {
          throw ErrorHelper.userNotExist();
        }
        req.tokenInfo = tokenData;
        next();
      } else {
        throw ErrorHelper.permissionDeny();
      }
    } catch {
      throw ErrorHelper.unauthorized();
    }
  }

    async updateBalanceForAdmin(req:Request,res:Response){
      if(req.tokenInfo.role_!=ROLES.ADMIN){
        throw ErrorHelper.permissionDeny();
      }

      let {id, updateBalance} = req.body;

      let wallet = await WalletModel.findById(id);
      if(!wallet){
        throw ErrorHelper.forbidden("khong tim thay vi");
      }

       wallet.balance = updateBalance;
      await wallet.save();
      return res.status(200).json({
        status:200,
        code:"200",
        message:"succes",
        data:{
          wallet,
        }
      })

    }

}
export default new WalletRoute().router;
