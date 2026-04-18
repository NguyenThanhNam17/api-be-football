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
    const userId = String(req.query.userId || req.body?.userId || "").trim();
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
    user.isDeleted = true;
    await user.save();
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

    const { userId } = req.body;

    if (!userId || !Types.ObjectId.isValid(userId as string)) {
      throw ErrorHelper.requestDataInvalid("userId không hợp lệ");
    }

    const userObjectId = new Types.ObjectId(userId as string);

    const user = await UserModel.findById(userObjectId);

    if (!user) {
      throw ErrorHelper.userNotExist();
    }

    if (user._id.toString() === req.tokenInfo._id) {
      throw ErrorHelper.requestDataInvalid("Không thể xoá chính mình");
    }

    user.isDeleted = true;
    await user.save();

    const fields = await FieldModel.find({
      ownerUserId: userObjectId,
      isDeleted: false,
    });

    const fieldIds = fields.map((f) => f._id);

    const hasPaidBooking = await BookingModel.findOne({
      fieldId: { $in: fieldIds },
      isDeleted: false,
      depositStatus: DepositStatusEnum.PAID,
      status: { $ne: BookingStatusEnum.COMPLETED },
    });

    if (hasPaidBooking) {
      throw ErrorHelper.requestDataInvalid(
        "Không thể xoá owner vì có booking đã được đặt cọc",
      );
    }

    if (fieldIds.length > 0) {
      const bookings = await BookingModel.find({
        fieldId: { $in: fieldIds },
        isDeleted: false,
      });

      const now = new Date();

      for (const booking of bookings) {
        const bookingDate = new Date(booking.date);

        // ⚠️ Lấy timeslot
        const timeSlot = await TimeSlotModel.findById(booking.timeSlotId);

        const startTime = timeSlot?.startTime || "00:00";
        const [hour, minute] = startTime.split(":").map(Number);

        const bookingStartTime = new Date(bookingDate);
        bookingStartTime.setHours(hour, minute, 0, 0);

        if (bookingStartTime > now) {
          booking.status = BookingStatusEnum.CANCELLED;
          booking.cancelReason = "Tài khoản chủ sân đã bị xoá";

          await booking.save();
          continue;
        }

        booking.status = BookingStatusEnum.COMPLETED;
        booking.cancelReason = "Chủ sân bị xoá trong khi đang sử dụng";

        await booking.save();
      }
    }

    await FieldModel.updateMany(
      { ownerUserId: userObjectId },
      { isDeleted: true },
    );

    await SubFieldModel.updateMany(
      { fieldId: { $in: fieldIds } },
      { isDeleted: true },
    );

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "Xoá user thành công",
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
