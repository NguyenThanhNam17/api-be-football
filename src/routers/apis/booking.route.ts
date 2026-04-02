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
import { PaymentModel } from "../../models/Payment/payment.model";
import {
  BookingStatusEnum,
  DepositStatusEnum,
} from "../../constants/model.const";
import {
  buildActiveBookingFilter,
  expireStalePendingBookings,
  getBookingHoldExpiresAt,
} from "../../helper/bookingHold.helper";

const toObjectId = (value: any) => {
  const normalizedValue =
    value && typeof value === "object" && value._id ? value._id : value;

  if (!normalizedValue || !Types.ObjectId.isValid(normalizedValue)) {
    return null;
  }

  return new Types.ObjectId(normalizedValue);
};

const getTimeSlotLabel = (timeSlot: any) => {
  const startTime = String(timeSlot?.startTime || "").trim();
  const endTime = String(timeSlot?.endTime || "").trim();

  if (startTime && endTime) {
    return `${startTime} - ${endTime}`;
  }

  return String(timeSlot?.label || "").trim();
};

const buildCustomerInfo = (booking: any) => {
  const user = booking?.userId && typeof booking.userId === "object" ? booking.userId : null;

  return {
    id: String(user?._id || booking?.userId || "").trim(),
    fullName: String(user?.name || "").trim() || "Khách hàng",
    email: String(user?.email || "").trim(),
    phone: String(booking?.phone || user?.phone || "").trim(),
  };
};

const serializeBooking = (booking: any, latestPaymentsByBookingId: Map<string, any>) => {
  const rawBooking =
    booking && typeof booking.toObject === "function" ? booking.toObject() : booking;
  const field = rawBooking?.fieldId && typeof rawBooking.fieldId === "object" ? rawBooking.fieldId : null;
  const subField =
    rawBooking?.subFieldId && typeof rawBooking.subFieldId === "object"
      ? rawBooking.subFieldId
      : null;
  const timeSlot =
    rawBooking?.timeSlotId && typeof rawBooking.timeSlotId === "object"
      ? rawBooking.timeSlotId
      : null;
  const latestPayment = latestPaymentsByBookingId.get(String(rawBooking?._id || "")) || null;
  const timeSlotLabel = getTimeSlotLabel(timeSlot);
  const holdExpiresAt =
    rawBooking?.expiredAt || getBookingHoldExpiresAt(rawBooking).toISOString();

  return {
    ...rawBooking,
    id: rawBooking?._id,
    bookingId: rawBooking?._id,
    userId: rawBooking?.userId?._id || rawBooking?.userId,
    fieldId: field?._id || rawBooking?.fieldId,
    subFieldId: subField?._id || rawBooking?.subFieldId,
    timeSlotId: timeSlot?._id || rawBooking?.timeSlotId,
    field: field
      ? {
          _id: field._id,
          id: field._id,
          name: field.name,
          address: field.address,
        }
      : undefined,
    subField: subField
      ? {
          _id: subField._id,
          id: subField._id,
          name: subField.name,
          type: subField.type,
        }
      : undefined,
    fieldName: String(field?.name || "").trim(),
    fieldAddress: String(field?.address || "").trim(),
    subFieldName: String(subField?.name || "").trim(),
    subFieldType: String(subField?.type || "").trim(),
    timeSlot: timeSlotLabel,
    timeSlotLabel,
    timeSlotInfo: timeSlot
      ? {
          _id: timeSlot._id,
          id: timeSlot._id,
          startTime: timeSlot.startTime,
          endTime: timeSlot.endTime,
          label: timeSlotLabel,
          timeSlot: timeSlotLabel,
        }
      : undefined,
    customer: buildCustomerInfo(rawBooking),
    paymentId: latestPayment?._id,
    paymentStatus: String(latestPayment?.status || "").trim(),
    holdExpiresAt,
    expiredAt: holdExpiresAt,
  };
};

const getLatestPaymentsByBookingIds = async (bookingIds: Types.ObjectId[] = []) => {
  if (!bookingIds.length) {
    return new Map<string, any>();
  }

  const payments = await PaymentModel.find({
    bookingId: { $in: bookingIds },
    isDeleted: false,
  }).sort({ createdAt: -1 });

  const latestPaymentsByBookingId = new Map<string, any>();

  payments.forEach((payment) => {
    const bookingId = String(payment?.bookingId || "").trim();
    if (bookingId && !latestPaymentsByBookingId.has(bookingId)) {
      latestPaymentsByBookingId.set(bookingId, payment);
    }
  });

  return latestPaymentsByBookingId;
};

const canOwnerManageBooking = async (ownerId: string, booking: any) => {
  const ownerObjectId = toObjectId(ownerId);
  const fieldId = toObjectId(booking?.fieldId);
  if (!ownerObjectId || !fieldId) {
    return false;
  }

  const field = await FieldModel.findOne({
    _id: fieldId,
    ownerUserId: ownerObjectId,
    isDeleted: false,
  } as any).select("_id");

  return Boolean(field);
};

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
    this.router.get("/getBookedSlots", this.route(this.getBookedSlots));
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
      _id: timeSlotId,
    });

    if (!timeSlot) {
      throw ErrorHelper.forbidden("Thời gian không tồn tại");
    }

    const bookingDate = new Date(date);

    const now = new Date();

    await expireStalePendingBookings(
      {
        subFieldId: new Types.ObjectId(subFieldId),
        timeSlotId: new Types.ObjectId(timeSlotId),
        date: bookingDate,
      },
      now,
    );

    const existed = await BookingModel.findOne(
      buildActiveBookingFilter(
        {
          subFieldId: new Types.ObjectId(subFieldId),
          timeSlotId: new Types.ObjectId(timeSlotId),
          date: bookingDate,
        },
        now,
      ),
    );

    if (existed) {
      throw ErrorHelper.requestDataInvalid("Slot đang được giữ hoặc đã đặt");
    }

    const totalPrice = subField.pricePerHour;
    const depositAmount = totalPrice * 0.3;
    const remainingAmount = totalPrice - depositAmount;
    const expiredAt = new Date(now.getTime() + 5 * 60 * 1000);

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
        expiredAt,
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
    let query: any = {
      isDeleted: false,
    };

    if (req.tokenInfo.role_ === ROLES.OWNER) {
      const ownerObjectId = new Types.ObjectId(req.tokenInfo._id);
      const ownedFieldIds = await FieldModel.find({
        ownerUserId: ownerObjectId,
        isDeleted: false,
      } as any).distinct("_id");

      query.fieldId = {
        $in: ownedFieldIds,
      };
    } else if (req.tokenInfo.role_ !== ROLES.ADMIN) {
      query.userId = new Types.ObjectId(req.tokenInfo._id);
    }

    const bookings = await BookingModel.find(query)
      .populate("fieldId", "name address ownerUserId")
      .populate("subFieldId", "name type")
      .populate("timeSlotId", "startTime endTime label")
      .populate("userId", "name email phone")
      .sort({ createdAt: -1 });
    const latestPaymentsByBookingId = await getLatestPaymentsByBookingIds(
      bookings
        .map((booking) => toObjectId(booking?._id))
        .filter((bookingId): bookingId is Types.ObjectId => Boolean(bookingId)),
    );

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        bookings: bookings.map((booking) =>
          serializeBooking(booking, latestPaymentsByBookingId),
        ),
      },
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

    if (
      req.tokenInfo.role_ === ROLES.OWNER &&
      !(await canOwnerManageBooking(req.tokenInfo._id, booking))
    ) {
      throw ErrorHelper.permissionDeny();
    }

    if (!Object.values(BookingStatusEnum).includes(status)) {
      throw ErrorHelper.requestDataInvalid("Status không hợp lệ");
    }

    booking.status = status;

    if (status === BookingStatusEnum.CONFIRMED) {
      booking.expiredAt = undefined;
      booking.depositStatus = DepositStatusEnum.PAID;
    }

    await booking.save();

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: { booking },
    });
  }

  async getBookedSlots(req: Request, res: Response) {
    const { subFieldId, date } = req.query;

    if (!subFieldId || !date) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
    }

    const bookingDate = new Date(date as string);
    const now = new Date();
    const normalizedSubFieldId = String(subFieldId || "").trim();

    await expireStalePendingBookings(
      {
        subFieldId: new Types.ObjectId(normalizedSubFieldId),
        date: bookingDate,
      },
      now,
    );

    const bookings = await BookingModel.find(
      buildActiveBookingFilter(
        {
          subFieldId: new Types.ObjectId(normalizedSubFieldId),
          date: bookingDate,
        },
        now,
      ),
    ).populate("timeSlotId", "startTime endTime label");

    const bookedTimeSlotIds = bookings
      .map((booking) => {
        const bookingObject =
          booking && typeof booking.toObject === "function" ? booking.toObject() : booking;
        const timeSlotId = bookingObject?.timeSlotId;
        return String(timeSlotId?._id || timeSlotId || "").trim();
      })
      .filter(Boolean);

    return res.json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        bookedTimeSlotIds,
        bookings: bookings.map((booking) =>
          serializeBooking(booking, new Map<string, any>()),
        ),
      },
    });
  }
}

export default new BookingRoute().router;
