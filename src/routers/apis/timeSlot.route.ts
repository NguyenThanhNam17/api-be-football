import { ErrorHelper } from "../../base/error";
import {
  BaseRoute,
  Request,
  Response,
  NextFunction,
} from "../../base/baseRoute";
import { UserModel } from "../../models/user/user.model";
import { TokenHelper } from "../../helper/token.helper";
import { ROLES } from "../../constants/role.const";
import { TimeSlotModel } from "../../models/TimeSlot/timeSlot.model";
import { Types } from "mongoose";

class TimeSlotRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post(
      "/createTimeSlot",
      [this.authentication],
      this.route(this.createTimeSlot),
    );
    this.router.get("/getTimeSlot/:id", this.route(this.getTimeSlot));
    this.router.get("/getAllTimeSlot", this.route(this.getAllTimeSlot));
    this.router.post(
      "/deleteTimeSlot/:id",
      [this.authentication],
      this.route(this.deleteTimeSlot),
    );
    this.router.post(
      "/updateTimeSlot/:id",
      [this.authentication],
      this.route(this.updateTimeSlot),
    );
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

  async createTimeSlot(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    let { startTime, endTime } = req.body;
    if (!startTime || !endTime) {
      throw ErrorHelper.requestDataInvalid("Thiếu startTime hoặc endTime");
    }

    const label = `${startTime} - ${endTime}`;

    let existed = await TimeSlotModel.findOne({
      startTime,
      endTime,
      isDeleted: false,
    });

    if (existed) {
      throw ErrorHelper.requestDataInvalid("TimeSlot đã tồn tại");
    }

    const timeSlot = await TimeSlotModel.create({
      startTime,
      endTime,
      label,
    });

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        timeSlot,
      },
    });
  }

  async getAllTimeSlot(req: Request, res: Response) {
    const timeSlots = await TimeSlotModel.find({
      isDeleted: false,
    }).sort({ startTime: 1 });

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { timeSlots },
    });
  }

  async getTimeSlot(req: Request, res: Response) {
    let { id } = req.params;
    const timeSlot = await TimeSlotModel.findOne({
      _id: id,
      isDeleted: false,
    });
    if (!timeSlot) {
      throw ErrorHelper.forbidden("TimeSlot không tồn tại");
    }
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        timeSlot,
      },
    });
  }

  async deleteTimeSlot(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    let { id } = req.params;
    const timeSlot = await TimeSlotModel.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!timeSlot) {
      throw ErrorHelper.forbidden("Không tìm thấy timeSlot");
    }

    timeSlot.isDeleted = true;
    await timeSlot.save();
    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        timeSlot,
      },
    });
  }

  async updateTimeSlot(req: Request, res: Response) {
    if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      throw ErrorHelper.permissionDeny();
    }
    const id = req.params.id as string;
    let { startTime, endTime } = req.body;

    if (!id || !Types.ObjectId.isValid(id)) {
      throw ErrorHelper.requestDataInvalid("Id không hợp lệ");
    }

    const timeSlot = await TimeSlotModel.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!timeSlot) {
      throw ErrorHelper.requestDataInvalid("TimeSlot không tồn tại");
    }

    // 2. nếu có thay đổi → check trùng
    if (startTime || endTime) {
      const newStart = startTime || timeSlot.startTime;
      const newEnd = endTime || timeSlot.endTime;

      const existed = await TimeSlotModel.findOne({
        startTime: newStart,
        endTime: newEnd,
        _id: { $ne: new Types.ObjectId(id) },
        isDeleted: false,
      });

      if (existed) {
        throw ErrorHelper.requestDataInvalid("TimeSlot bị trùng");
      }

      timeSlot.startTime = newStart;
      timeSlot.endTime = newEnd;
      timeSlot.label = `${newStart} - ${newEnd}`;
    }

    await timeSlot.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { timeSlot },
    });
  }
}

export default new TimeSlotRoute().router;
