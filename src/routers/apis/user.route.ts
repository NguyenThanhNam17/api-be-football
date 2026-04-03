import { ErrorHelper } from "../../base/error";
import {
  BaseRoute,
  Request,
  Response,
  NextFunction,
} from "../../base/baseRoute";
import { UserModel } from "../../models/user/user.model";
import passwordHash from "password-hash";
import { TokenHelper } from "../../helper/token.helper";
import { UserHelper } from "../../models/user/user.helper";
import { ROLES } from "../../constants/role.const";
import {
  invalidateOtpCode,
  issueOtpCode,
  verifyOtpCode,
} from "../../helper/otp.helper";
import {
  getSmtpMissingConfigMessage,
  isSmtpConfigured,
  sendOtpEmail,
} from "../../helper/mail.helper";

class UserRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/sendOtp", this.route(this.sendOtp));
    this.router.post("/verifyOtp", this.route(this.verifyOtp));
    this.router.post("/login", this.route(this.login));
    this.router.post("/register", this.route(this.register));
    this.router.get("/getMe", [this.authentication], this.route(this.getMe));
    this.router.get("/getAllUser", this.route(this.getAllUser));
    this.router.get(
      "/getOneUser",
      [this.authentication],
      this.route(this.getOneUser),
    );
    this.router.post(
      "/createUser",
      [this.authentication],
      this.route(this.createUser),
    );
    this.router.post(
      "/updateUser",
      [this.authentication],
      this.route(this.updateUser),
    );
    this.router.post(
      "/deleteUser",
      [this.authentication],
      this.route(this.deleteUser),
    );
    this.router.post(
      "/updateUserForAdmin",
      [this.authentication],
      this.route(this.updateUserForAdmin),
    );
    this.router.post(
      "/requestOwner",
      [this.authentication],
      this.route(this.requestOwner),
    );
    this.router.post(
      "/approveOwner/:userId",
      [this.authentication],
      this.route(this.approveOwner),
    );
    this.router.get(
      "/getOwnerRequests",
      [this.authentication],
      this.route(this.getOwnerRequests),
    );
    this.router.post(
      "/rejectOwner/:userId",
      [this.authentication],
      this.route(this.rejectOwner),
    );
    this.router.delete(
      "/deleteUserByAdmin/:userId",
      [this.authentication],
      this.route(this.deleteUserByAdmin),
    );

    this.router.post(
      "/downgradeOwner/:userId",
      [this.authentication],
      this.route(this.downgradeOwner),
    );
  }

  async sendOtp(req: Request, res: Response) {
    const { email, purpose } = req.body || {};

    if (!email) {
      throw ErrorHelper.requestDataInvalid("email required");
    }

    if (!isSmtpConfigured()) {
      throw ErrorHelper.requestDataInvalid(getSmtpMissingConfigMessage());
    }

    const issuedOtp = await issueOtpCode({
      email: String(email || ""),
      purpose: String(purpose || "auth"),
    });

    try {
      await sendOtpEmail({
        to: issuedOtp.email,
        otp: issuedOtp.otp,
        purpose: issuedOtp.purpose,
        expiresInMinutes: issuedOtp.expiresInMinutes,
      });
    } catch (_error) {
      await invalidateOtpCode(issuedOtp.otpId);
      throw ErrorHelper.somethingWentWrong("Can not send OTP email");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        email: issuedOtp.email,
        purpose: issuedOtp.purpose,
        expiresAt: issuedOtp.expiresAt,
        expiresInMinutes: issuedOtp.expiresInMinutes,
      },
    });
  }

  async verifyOtp(req: Request, res: Response) {
    const { email, otp, purpose } = req.body || {};

    if (!email || !otp) {
      throw ErrorHelper.requestDataInvalid("email and otp required");
    }

    const verification = await verifyOtpCode({
      email: String(email || ""),
      otp: String(otp || ""),
      purpose: String(purpose || "auth"),
    });

    if (!verification.isValid) {
      throw ErrorHelper.requestDataInvalid(verification.message || "OTP invalid");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        email: String(email || "").trim().toLowerCase(),
        purpose: String(purpose || "auth").trim().toLowerCase(),
        verified: true,
      },
    });
  }

  async authentication(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.get("x-token")) {
        throw ErrorHelper.unauthorized();
      }
      const tokenData: any = TokenHelper.decodeToken(req.get("x-token"));
      if ([ROLES.ADMIN, ROLES.USER, ROLES.OWNER].includes(tokenData.role_)) {
        const user = await UserModel.findById(tokenData._id);
        if (!user) {
          throw ErrorHelper.unauthorized();
        }
        req.tokenInfo = tokenData;
        next();
      } else {
        throw ErrorHelper.permissionDeny();
      }
    } catch (err) {
      throw ErrorHelper.unauthorized();
    }
  }

  async login(req: Request, res: Response) {
    let { username, password } = req.body;
    if (!username || !password) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }

    let user = await UserModel.findOne({
      $or: [{ phone: username }, { email: username }],
    });

    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    let checkPassword = passwordHash.verify(password, user.password);
    if (!checkPassword) {
      throw ErrorHelper.userPasswordNotCorrect();
    }

    let key = TokenHelper.generateKey();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
        token: new UserHelper(user).getToken(key),
      },
    });
  }

  async register(req: Request, res: Response) {
    let { name, email, phone, password } = req.body;
    if (!name || !email || !phone || !password) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    let user = await UserModel.findOne({
      $or: [{ phone }, { email }],
    });
    if (user) {
      throw ErrorHelper.userExisted();
    }

    const key = TokenHelper.generateKey();

    user = new UserModel({
      name: name,
      email: email,
      phone: phone,
      password: passwordHash.generate(password),
      key: key,
      role: ROLES.USER,
    });

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
        token: new UserHelper(user).getToken(key),
      },
    });
  }

  async getMe(req: Request, res: Response) {
    const user = await UserModel.findById(req.tokenInfo._id);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
      },
    });
  }

  async getAllUser(req: Request, res: Response) {
    const users = await UserModel.find();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        users,
      },
    });
  }

  async getOneUser(req: Request, res: Response) {
    const { userId } = req.body;
    if (!userId) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
      },
    });
  }

  async createUser(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    let { name, email, phone, password, role } = req.body;
    if (!name || !email || !phone || !password || !role) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    let user = await UserModel.findOne({
      $or: [{ phone }, { email }],
    });
    if (user) {
      throw ErrorHelper.userExisted();
    }
    const key = TokenHelper.generateKey();
    user = new UserModel({
      name: name,
      email: email,
      phone: phone,
      key: key,
      password: passwordHash.generate(password),
      role: role,
    });
    await user.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
        token: new UserHelper(user).getToken(key),
      },
    });
  }

  async deleteUser(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { userId } = req.body;
    if (!userId) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    await UserModel.deleteOne({ _id: userId });
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
    });
  }

  async updateUser(req: Request, res: Response) {
    const { name, email, phone, password } = req.body;
    if (!name && !email && !phone && !password) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    const user = await UserModel.findById(req.tokenInfo._id);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.password = password ? passwordHash.generate(password) : user.password;
    await user.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
      },
    });
  }

  async updateUserForAdmin(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { userId, name, email, phone, password, role } = req.body;
    if (!userId) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    user.name = name || user.name;
    user.email = email || user.email;
    user.phone = phone || user.phone;
    user.password = password ? passwordHash.generate(password) : user.password;
    user.role = role || user.role;
    await user.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        user,
      },
    });
  }

  async requestOwner(req: Request, res: Response) {
    const user = await UserModel.findById(req.tokenInfo._id);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (user.role === ROLES.OWNER) {
      throw ErrorHelper.requestDataInvalid("Bạn đã là chủ sân");
    }

    if (user.isRequestOwner) {
      throw ErrorHelper.requestDataInvalid("Bạn đã gửi yêu cầu rồi");
    }

    user.isRequestOwner = true;

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { user },
    });
  }

  async approveOwner(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { userId } = req.params;

    if (!userId) {
      throw ErrorHelper.requestDataInvalid("Thiếu userId");
    }

    const user = await UserModel.findById(userId);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (!user.isRequestOwner) {
      throw ErrorHelper.requestDataInvalid("User chưa gửi yêu cầu");
    }

    user.role = ROLES.OWNER;
    user.isRequestOwner = false;

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { user },
    });
  }

  async getOwnerRequests(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const users = await UserModel.find({
      isRequestOwner: true,
      isDeleted: false,
    }).select("name email phone createdAt");

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        users,
      },
    });
  }
  async rejectOwner(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { userId } = req.params;

    const user = await UserModel.findById(userId);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (!user.isRequestOwner) {
      throw ErrorHelper.requestDataInvalid("User chưa gửi yêu cầu");
    }

    user.isRequestOwner = false;

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { user },
    });
  }
  async deleteUserByAdmin(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { userId } = req.params;

    const user = await UserModel.findById(userId);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (user._id.toString() === req.tokenInfo._id) {
      throw ErrorHelper.requestDataInvalid("Không thể xoá chính mình");
    }

    user.isDeleted = true;

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
    });
  }

  async downgradeOwner(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }

    const { userId } = req.params;

    const user = await UserModel.findById(userId);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (user.role !== ROLES.OWNER) {
      throw ErrorHelper.requestDataInvalid("User không phải OWNER");
    }

    user.role = ROLES.USER;

    await user.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { user },
    });
  }
}

export default new UserRoute().router;
