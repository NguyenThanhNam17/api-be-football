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
import { FieldModel } from "../../models/field/field.model";
import { Types } from "mongoose";
import { SubFieldModel } from "../../models/subField/subField.model";
import { TimeSlotModel } from "../../models/TimeSlot/timeSlot.model";
import { BookingModel } from "../../models/booking/booking.model";
import {
  BookingStatusEnum,
  DepositStatusEnum,
} from "../../constants/model.const";

class BookingRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post(
      "/createBooking",
      [this.authentication],
      this.route(this.createBooking),
    );
    this.router.get("/getBooking/:id", this.route(this.getBooking));
    this.router.post(
      "/getMyBookings",
      [this.authentication],
      this.route(this.getMyBookings),
    );
    this.router.get(
      "/cancelBooking/:id",
      [this.authentication],
      this.route(this.cancelBooking),
    );
    this.router.post(
      "/updateStatus/:id",
      [this.authentication],
      this.route(this.updateStatus),
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

  async createBooking(req: Request, res: Response) {
    const { subFieldId, timeSlotId, date, phone, note } = req.body;
    if (!subFieldId || !timeSlotId || !date || !phone) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
    }

    if (
      !Types.ObjectId.isValid(subFieldId) ||
      !Types.ObjectId.isValid(timeSlotId)
    ) {
      throw ErrorHelper.forbidden("Id không hợp lệ");
    }

    let subField = await SubFieldModel.findOne({
      _id: subFieldId,
      isDeleted: false,
    });

    if (!subField) {
      throw ErrorHelper.forbidden("Sân không tồn tại");
    }

    let field = await FieldModel.findOne({
      _id: subField.fieldId,
      isDeleted: false,
    });

    if (!field) {
      throw ErrorHelper.forbidden("Sân không tồn tại");
    }

    let timeSlot = await TimeSlotModel.findOne({
      _id: timeSlotId    });

    if (!timeSlot) {
      throw ErrorHelper.forbidden("Thời gian không tồn tại");
    }

    const bookingDate = new Date(date);

    const existed = await BookingModel.findOne({
      subFieldId,
      timeSlotId,
      date: bookingDate,
      isDeleted: false,
    });

    if (existed) {
      throw ErrorHelper.forbidden("booking đã tồn tại");
    }

    const totalPrice = subField.pricePerHour;
    const depositAmount = totalPrice * 0.3;
    const remainingAmount = totalPrice - depositAmount;

    try {
      const booking = new BookingModel({
        userId: req.tokenInfo._id,
        fieldId: field._id,
        subFieldId,
        timeSlotId,
        date: bookingDate,
        phone,
        note,
        totalPrice,
        depositAmount,
        remainingAmount,
        status: BookingStatusEnum.PENDING,
        depositStatus: DepositStatusEnum.UNPAID,
      });

      await booking.save();
      return res.status(200).json({
        status: 200,
        code: "200",
        message: "success",
        data: {
          booking,
        },
      });
    } catch (err: any) {
      if (err.code === 11000) {
        throw ErrorHelper.requestDataInvalid("Slot đã bị người khác đặt");
      }
      throw err;
    }
  }

  async getBooking(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id booking");
    }

    const booking = await BookingModel.findOne({
      _id: id,
      isDeleted: false,
    })
      .populate("fieldId", "name address")
      .populate("subFieldId", "name type")
      .populate("timeSlotId", "startTime endTime");

    if (!booking) {
      throw ErrorHelper.forbidden("Không tìm thấy booking");
    }

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { booking },
    });
  }

  async getMyBookings(req: Request, res: Response) {
    const bookings = await BookingModel.find({
      userId: new Types.ObjectId(req.tokenInfo._id),
      isDeleted: false,
    })
      .populate("fieldId", "name address")
      .populate("subFieldId", "name type")
      .populate("timeSlotId", "startTime endTime")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { bookings },
    });
  }

  async cancelBooking(req: Request, res: Response) {
    const { id } = req.params;

    if (!id) {
      throw ErrorHelper.requestDataInvalid("Thiếu id booking");
    }

    const booking = await BookingModel.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!booking) {
      throw ErrorHelper.forbidden("Không tìm thấy booking");
    }

    if (booking.userId.toString() !== req.tokenInfo._id) {
      throw ErrorHelper.permissionDeny();
    }

    if (booking.status === BookingStatusEnum.COMPLETED) {
      throw ErrorHelper.forbidden("Không thể huỷ booking đã hoàn thành");
    }

    booking.status = BookingStatusEnum.CANCELLED;

    await booking.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
    });
  }

  async updateStatus(req: Request, res: Response) {
    const { id } = req.params;
    const { status } = req.body;

    if (!id || !status) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
    }

    const booking = await BookingModel.findOne({
      _id: id,
      isDeleted: false,
    });

    if (!booking) {
      throw ErrorHelper.forbidden("Không tìm thấy booking");
    }

    if (![ROLES.ADMIN, ROLES.OWNER].includes(req.tokenInfo.role_)) {
      throw ErrorHelper.permissionDeny();
    }

    if (!Object.values(BookingStatusEnum).includes(status)) {
      throw ErrorHelper.requestDataInvalid("Status không hợp lệ");
    }

    await booking.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { booking },
    });
  }
}

export default new BookingRoute().router;
