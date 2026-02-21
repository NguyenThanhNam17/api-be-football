import { TokenHelper } from "../../helper/token.helper";
import { IUser } from "../user/user.model";

export class UserHelper {
  constructor(private user: IUser) {}
  value() {
    return this.user;
  }

  getToken(key?: string) {
    return TokenHelper.generateToken({
      _id: this.user._id.toString(),
      role_: this.user.role,
      key_: key ?? "",
      username: this.user.name || this.user.email || this.user.phone,
    });
  }
}
