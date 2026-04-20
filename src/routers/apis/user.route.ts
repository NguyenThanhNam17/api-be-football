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
  activateIssuedOtpCode,
  invalidateOtpCode,
  issueOtpCode,
  verifyOtpCode,
} from "../../helper/otp.helper";
import {
  ensureMailProviderReady,
  getSmtpMissingConfigMessage,
  getSmtpSendFailureMessage,
  isSmtpConfigured,
  logSmtpSendFailure,
  sendOtpEmail,
} from "../../helper/mail.helper";
import { BookingModel } from "../../models/booking/booking.model";
import { FieldModel } from "../../models/field/field.model";
import {
  BookingStatusEnum,
  DepositStatusEnum,
} from "../../constants/model.const";
import { TimeSlotModel } from "../../models/TimeSlot/timeSlot.model";
import { Types } from "mongoose";
import { SubFieldModel } from "../../models/subField/subField.model";

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
    this.router.post(
      "/deleteUserByAdmin",
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
    const normalizedEmail = String(email || "")
      .trim()
      .toLowerCase();
    const normalizedPurpose = String(purpose || "auth")
      .trim()
      .toLowerCase();

    if (!email) {
      throw ErrorHelper.requestDataInvalid("email required");
    }

    if (!isSmtpConfigured()) {
      throw ErrorHelper.requestDataInvalid(getSmtpMissingConfigMessage());
    }

    try {
      await ensureMailProviderReady();
    } catch (error) {
      logSmtpSendFailure(error, {
        route: "/api/user/sendOtp",
        email: normalizedEmail,
        purpose: normalizedPurpose,
        phase: "provider_ready_check",
      });
      throw ErrorHelper.serviceUnavailable(getSmtpSendFailureMessage(error));
    }

    let issuedOtp: Awaited<ReturnType<typeof issueOtpCode>>;

    try {
      issuedOtp = await issueOtpCode({
        email: String(email || ""),
        purpose: String(purpose || "auth"),
      });
    } catch (error) {
      throw ErrorHelper.requestDataInvalid(
        String((error as Error)?.message || "Can not issue OTP."),
      );
    }

    try {
      await sendOtpEmail({
        to: issuedOtp.email,
        otp: issuedOtp.otp,
        purpose: issuedOtp.purpose,
        expiresInMinutes: issuedOtp.expiresInMinutes,
      });
      await activateIssuedOtpCode({
        otpId: issuedOtp.otpId,
        email: issuedOtp.email,
        purpose: issuedOtp.purpose,
      });
    } catch (error) {
      await invalidateOtpCode(issuedOtp.otpId);
      logSmtpSendFailure(error, {
        route: "/api/user/sendOtp",
        email: issuedOtp.email,
        purpose: issuedOtp.purpose,
      });
      throw ErrorHelper.serviceUnavailable(getSmtpSendFailureMessage(error));
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
      throw ErrorHelper.requestDataInvalid(
        verification.message || "OTP invalid",
      );
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        email: String(email || "")
          .trim()
          .toLowerCase(),
        purpose: String(purpose || "auth")
          .trim()
          .toLowerCase(),
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
    let { id } = req.body;
    let user = await UserModel.findById(id);
    if (!user) {
      throw ErrorHelper.requestDataInvalid("data invalid");
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
  // 🔐 chỉ admin được tạo
  if (req.tokenInfo.role_ !== ROLES.ADMIN) {
    throw ErrorHelper.permissionDeny();
  }

  const { name, email, phone, password, role } = req.body;

  if (!name || !email || !phone || !password) {
    throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
  }

  // 🔥 chỉ cho USER hoặc OWNER
  const allowedRoles = [ROLES.USER, ROLES.OWNER];

  let finalRole = ROLES.USER; // default

  if (role) {
    if (!allowedRoles.includes(role)) {
      throw ErrorHelper.requestDataInvalid(
        "Role chỉ được phép là USER hoặc OWNER",
      );
    }
    finalRole = role;
  }

  // 🔎 check trùng
  const existed = await UserModel.findOne({
    $or: [{ phone }, { email }],
  });

  if (existed) {
    throw ErrorHelper.userExisted();
  }

  const key = TokenHelper.generateKey();

  const user = new UserModel({
    name,
    email,
    phone,
    key,
    password: passwordHash.generate(password),
    role: finalRole, // 🔥 dùng role đã validate
  });

  await user.save();

  return res.status(200).json({
    status: 200,
    code: "200",
    message: "Tạo user thành công",
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
      data: {
        user,
      },
    });
  }

  async updateUserForAdmin(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const { userId, name, phone, password } = req.body;
    if (!userId) {
      throw ErrorHelper.requestDataInvalid("data invalid");
    }
    const user = await UserModel.findById(userId);
    if (!user) {
      throw ErrorHelper.userNotExist();
    }
    user.name = name || user.name;
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

  const { userId } = req.body;

  if (!userId || !Types.ObjectId.isValid(userId)) {
    throw ErrorHelper.requestDataInvalid("userId không hợp lệ");
  }

  const userObjectId = new Types.ObjectId(userId);

  const user = await UserModel.findById(userObjectId);
  if (!user) {
    throw ErrorHelper.userNotExist();
  }

  if (user._id.toString() === req.tokenInfo._id) {
    throw ErrorHelper.requestDataInvalid("Không thể xoá chính mình");
  }

  // 1. Lấy field
  const fields = await FieldModel.find({ ownerUserId: userObjectId });
  const fieldIds = fields.map((f) => f._id);

  // 2. Lấy subField
  const subFields = await SubFieldModel.find({
    fieldId: { $in: fieldIds },
  });
  const subFieldIds = subFields.map((s) => s._id);

  // 3. Check booking (QUAN TRỌNG - theo subField)
  const hasActiveBooking = await BookingModel.findOne({
    subFieldId: { $in: subFieldIds },
    status: { $ne: BookingStatusEnum.COMPLETED },
  });

  if (hasActiveBooking) {
    throw ErrorHelper.requestDataInvalid(
      "Không thể xoá owner vì sân con đang có booking chưa hoàn thành",
    );
  }

  // 🔥 4. XOÁ CỨNG THEO THỨ TỰ

  // xoá booking
  await BookingModel.deleteMany({
    subFieldId: { $in: subFieldIds },
  });

  // xoá subField
  await SubFieldModel.deleteMany({
    fieldId: { $in: fieldIds },
  });

  // xoá field
  await FieldModel.deleteMany({
    ownerUserId: userObjectId,
  });

  // xoá user
  await UserModel.deleteOne({
    _id: userObjectId,
  });

  return res.status(200).json({
    status: 200,
    code: "200",
    message: "success",
    data: { user },
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
