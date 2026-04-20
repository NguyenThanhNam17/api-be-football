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
  PaymentStatusEnum,
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

const timeStringToMinutes = (value: string) => {
  const normalizedValue = String(value || "").trim();
  const match = normalizedValue.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

const getTimeSlotDurationMinutes = (timeSlot: any) => {
  const startMinutes = timeStringToMinutes(String(timeSlot?.startTime || ""));
  const endMinutes = timeStringToMinutes(String(timeSlot?.endTime || ""));

  if (
    Number.isFinite(startMinutes) &&
    Number.isFinite(endMinutes) &&
    Number(endMinutes) > Number(startMinutes)
  ) {
    return Number(endMinutes) - Number(startMinutes);
  }

  return 60;
};

const buildCustomerInfo = (booking: any) => {
  const user =
    booking?.userId && typeof booking.userId === "object"
      ? booking.userId
      : null;
  const field =
    booking?.fieldId && typeof booking.fieldId === "object"
      ? booking.fieldId
      : null;
  const bookingUserId = String(user?._id || booking?.userId || "").trim();
  const ownerUserId = String(
    field?.ownerUserId?._id || field?.ownerUserId || "",
  ).trim();
  const isManualOwnerBooking =
    Boolean(bookingUserId) &&
    Boolean(ownerUserId) &&
    bookingUserId === ownerUserId;

  if (isManualOwnerBooking) {
    return {
      id: "",
      fullName: "Khách hàng",
      email: "",
      phone: String(booking?.phone || "").trim(),
      createdAt: null,
    };
  }

  return {
    id: String(user?._id || booking?.userId || "").trim(),
    fullName: String(user?.name || "").trim() || "Khách hàng",
    email: String(user?.email || "").trim(),
    phone: String(booking?.phone || user?.phone || "").trim(),
    createdAt: user?.createdAt || null,
  };
};

const serializeBooking = (
  booking: any,
  latestPaymentsByBookingId: Map<string, any>,
) => {
  const rawBooking =
    booking && typeof booking.toObject === "function"
      ? booking.toObject()
      : booking;
  const field =
    rawBooking?.fieldId && typeof rawBooking.fieldId === "object"
      ? rawBooking.fieldId
      : null;
  const subField =
    rawBooking?.subFieldId && typeof rawBooking.subFieldId === "object"
      ? rawBooking.subFieldId
      : null;
  const timeSlot =
    rawBooking?.timeSlotId && typeof rawBooking.timeSlotId === "object"
      ? rawBooking.timeSlotId
      : null;
  const latestPayment =
    latestPaymentsByBookingId.get(String(rawBooking?._id || "")) || null;
  const latestPaymentAmount = Number(latestPayment?.amount || 0);
  const latestPaymentStatus = String(latestPayment?.status || "")
    .trim()
    .toUpperCase();
  const latestPaymentType = String(latestPayment?.paymentType || "")
    .trim()
    .toUpperCase();
  const timeSlotLabel = getTimeSlotLabel(timeSlot);
  const holdExpiresAt =
    rawBooking?.expiredAt || getBookingHoldExpiresAt(rawBooking).toISOString();
  const isDepositPaid =
    String(rawBooking?.depositStatus || "")
      .trim()
      .toUpperCase() === DepositStatusEnum.PAID ||
    latestPaymentStatus === PaymentStatusEnum.PAID;
  const isFullyPaid =
    Number(rawBooking?.remainingAmount || 0) <= 0 ||
    (latestPaymentStatus === PaymentStatusEnum.PAID &&
      latestPaymentType === "FULL");

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
          slug: field.slug,
          district: field.district,
          ownerUserId: field.ownerUserId,
        }
      : undefined,
    subField: subField
      ? {
          _id: subField._id,
          id: subField._id,
          name: subField.name,
          type: subField.type,
          key: subField.key,
          pricePerHour: subField.pricePerHour,
        }
      : undefined,
    fieldName: String(field?.name || "").trim(),
    fieldSlug: String(field?.slug || "").trim(),
    fieldAddress: String(field?.address || "").trim(),
    fieldDistrict: String(field?.district || "").trim(),
    subFieldName: String(subField?.name || "").trim(),
    subFieldType: String(subField?.type || "").trim(),
    subFieldKey: String(subField?.key || "").trim(),
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
    paymentType: String(latestPayment?.paymentType || "").trim(),
    paymentMethod: String(latestPayment?.method || "").trim(),
    paidAmount: latestPaymentAmount,
    depositPaid: isDepositPaid,
    fullyPaid: isFullyPaid,
    depositPaidAt: isDepositPaid
      ? latestPayment?.updatedAt ||
        latestPayment?.createdAt ||
        rawBooking?.updatedAt ||
        null
      : null,
    fullyPaidAt: isFullyPaid
      ? latestPayment?.updatedAt || latestPayment?.createdAt || null
      : null,
    holdExpiresAt,
    expiredAt: holdExpiresAt,
  };
};

const getLatestPaymentsByBookingIds = async (
  bookingIds: Types.ObjectId[] = [],
) => {
  if (!bookingIds.length) {
    return new Map<string, any>();
  }

  const payments = await PaymentModel.find({
    $or: [
      { bookingId: { $in: bookingIds } },
      { bookingIds: { $in: bookingIds } },
    ],
  }).sort({ createdAt: -1 });

  const latestPaymentsByBookingId = new Map<string, any>();
  const requestedBookingIds = new Set(
    bookingIds.map((bookingId) => String(bookingId || "").trim()),
  );

  payments.forEach((payment) => {
    const linkedBookingIds = Array.from(
      new Set(
        [
          payment?.bookingId,
          ...(Array.isArray(payment?.bookingIds) ? payment.bookingIds : []),
        ]
          .map((bookingId) => String(bookingId || "").trim())
          .filter(Boolean),
      ),
    );

    linkedBookingIds.forEach((bookingId) => {
      if (
        requestedBookingIds.has(bookingId) &&
        !latestPaymentsByBookingId.has(bookingId)
      ) {
        latestPaymentsByBookingId.set(bookingId, payment);
      }
    });
  });

  return latestPaymentsByBookingId;
};

const DEFAULT_DASHBOARD_MONTHS = 6;
const DEFAULT_DASHBOARD_RECENT_LIMIT = 10;
const DEFAULT_DASHBOARD_MANAGED_LIMIT = 50;

const getTodayDateKey = () => new Date().toISOString().slice(0, 10);

const parseDashboardDate = (value: any) => {
  const normalizedValue = String(value || "").trim();

  if (!normalizedValue) {
    return getTodayDateKey();
  }

  const parsedDate = new Date(normalizedValue);

  if (Number.isNaN(parsedDate.getTime())) {
    return getTodayDateKey();
  }

  return parsedDate.toISOString().slice(0, 10);
};

const toPositiveInteger = (value: any, fallbackValue: number) => {
  const parsedValue = Number.parseInt(String(value ?? "").trim(), 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallbackValue;
  }

  return parsedValue;
};

const getBookingDateKey = (booking: any) => {
  const bookingDate = booking?.date ? new Date(booking.date) : null;

  if (!bookingDate || Number.isNaN(bookingDate.getTime())) {
    return "";
  }

  return bookingDate.toISOString().slice(0, 10);
};

const getMonthKey = (dateValue: any) => {
  const date = dateValue ? new Date(dateValue) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 7);
};

const getMonthLabel = (monthKey: string) => {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) {
    return monthKey;
  }

  const monthDate = new Date(`${monthKey}-01T00:00:00.000Z`);

  if (Number.isNaN(monthDate.getTime())) {
    return monthKey;
  }

  return `${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}/${monthDate.getUTCFullYear()}`;
};

const getBookingTimeSortValue = (booking: any) => {
  const startTime = String(
    booking?.timeSlotInfo?.startTime ||
      booking?.timeSlot?.split("-")?.[0] ||
      booking?.timeSlotLabel?.split("-")?.[0] ||
      "",
  )
    .trim()
    .slice(0, 5);

  if (!/^\d{2}:\d{2}$/.test(startTime)) {
    return Number.MAX_SAFE_INTEGER;
  }

  const [hours, minutes] = startTime
    .split(":")
    .map((value) => Number.parseInt(value, 10));

  return hours * 60 + minutes;
};

const sortDashboardBookings = (bookings: any[] = []) =>
  [...bookings].sort((left, right) => {
    const leftDateKey = getBookingDateKey(left);
    const rightDateKey = getBookingDateKey(right);

    if (leftDateKey !== rightDateKey) {
      return leftDateKey.localeCompare(rightDateKey);
    }

    const timeSortDiff =
      getBookingTimeSortValue(left) - getBookingTimeSortValue(right);

    if (timeSortDiff !== 0) {
      return timeSortDiff;
    }

    const fieldSortDiff = String(left?.fieldName || "").localeCompare(
      String(right?.fieldName || ""),
      "vi",
    );

    if (fieldSortDiff !== 0) {
      return fieldSortDiff;
    }

    const subFieldSortDiff = String(left?.subFieldName || "").localeCompare(
      String(right?.subFieldName || ""),
      "vi",
    );

    if (subFieldSortDiff !== 0) {
      return subFieldSortDiff;
    }

    const leftCreatedAt = new Date(left?.createdAt || 0).getTime();
    const rightCreatedAt = new Date(right?.createdAt || 0).getTime();

    return leftCreatedAt - rightCreatedAt;
  });

const isBlockingDashboardBooking = (booking: any, now: Date = new Date()) => {
  const status = String(booking?.status || "")
    .trim()
    .toUpperCase();
  const depositStatus = String(booking?.depositStatus || "")
    .trim()
    .toUpperCase();

  if (status === BookingStatusEnum.CANCELLED) {
    return false;
  }

  if (depositStatus === DepositStatusEnum.PAID) {
    return true;
  }

  if (
    [BookingStatusEnum.CONFIRMED, BookingStatusEnum.COMPLETED].includes(
      status as BookingStatusEnum,
    )
  ) {
    return true;
  }

  if (status === BookingStatusEnum.PENDING) {
    const createdAt = booking?.createdAt ? new Date(booking.createdAt) : null;

    if (!createdAt || Number.isNaN(createdAt.getTime())) {
      return false;
    }

    return getBookingHoldExpiresAt({ createdAt }).getTime() > now.getTime();
  }

  return false;
};

const getCustomerIdentity = (booking: any) => {
  const customerId = String(
    booking?.customer?.id || booking?.userId || "",
  ).trim();

  if (customerId) {
    return `id:${customerId}`;
  }

  const email = String(booking?.customer?.email || "")
    .trim()
    .toLowerCase();

  if (email) {
    return `email:${email}`;
  }

  const phone = String(booking?.customer?.phone || "").trim();

  if (phone) {
    return `phone:${phone}`;
  }

  const fullName = String(booking?.customer?.fullName || "")
    .trim()
    .toLowerCase();

  if (fullName) {
    return `name:${fullName}`;
  }

  return "";
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
    this.router.get(
      "/getMyBookings",
      [this.authentication],
      this.route(this.getMyBookings),
    );
    this.router.get(
      "/getDashboard",
      [this.authentication],
      this.route(this.getDashboard),
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
    });

    if (!subField) {
      throw ErrorHelper.forbidden("Sân không tồn tại");
    }

    let field = await FieldModel.findOne({
      _id: subField.fieldId,
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

    if (bookingDate < new Date()) {
      throw ErrorHelper.requestDataInvalid("Không thể đặt lịch trong quá khứ");
    }

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

    const slotDurationMinutes = getTimeSlotDurationMinutes(timeSlot);
    const totalPrice = Math.round(
      (Number(subField.pricePerHour || 0) * slotDurationMinutes) / 60,
    );
    const depositAmount = Math.round(totalPrice * 0.4);
    const remainingAmount = totalPrice - depositAmount;
    const expiredAt = new Date(now.getTime() + 5 * 60 * 1000);

    try {
      const booking = new BookingModel({
        userId: req.tokenInfo?._id || null,
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

    await expireStalePendingBookings(
      {
        _id: id,
      },
      new Date(),
    );

    const booking = await BookingModel.findOne({
      _id: id,
    })
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label");

    if (!booking) {
      throw ErrorHelper.forbidden("Không tìm thấy booking");
    }

    const latestPaymentsByBookingId = await getLatestPaymentsByBookingIds(
      [toObjectId(booking?._id)].filter(
        (bookingId): bookingId is Types.ObjectId => Boolean(bookingId),
      ),
    );

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        booking: serializeBooking(booking, latestPaymentsByBookingId),
      },
    });
  }

  async getMyBookings(req: Request, res: Response) {
  const query: any = {};

  if (!req.tokenInfo) {
    throw ErrorHelper.unauthorized();
  }

  // 👇 OWNER: lấy tất cả field của owner
  if (req.tokenInfo.role_ === ROLES.OWNER) {
    const ownerObjectId = new Types.ObjectId(req.tokenInfo._id);

    const fieldIds = await FieldModel.find({
      ownerUserId: ownerObjectId,
    }).distinct("_id");

    query.fieldId = { $in: fieldIds };
  }

  // 👇 USER: chỉ lấy booking của mình
  else if (req.tokenInfo.role_ === ROLES.USER) {
    query.userId = new Types.ObjectId(req.tokenInfo._id);
  }

  // 👇 ADMIN: không cần filter (xem tất cả)

  const bookings = await BookingModel.find(query)
    .populate("fieldId", "name address")
    .populate("subFieldId", "name")
    .populate("timeSlotId", "startTime endTime")
    .sort({ createdAt: -1 });

  return res.status(200).json({
    status: 200,
    code: "200",
    message: "success",
    data: {
      bookings,
    },
  });
}

 async getDashboard(req: Request, res: Response) {
  if (![ROLES.ADMIN, ROLES.OWNER].includes(req.tokenInfo.role_)) {
    throw ErrorHelper.permissionDeny();
  }

  let fieldIds: Types.ObjectId[] = [];

  // 👇 OWNER → chỉ lấy sân của mình
  if (req.tokenInfo.role_ === ROLES.OWNER) {
    fieldIds = await FieldModel.find({
      ownerUserId: req.tokenInfo._id,
    }).distinct("_id");
  } else {
    // 👇 ADMIN → lấy tất cả
    fieldIds = await FieldModel.find().distinct("_id");
  }

  const bookings = await BookingModel.find({
    fieldId: { $in: fieldIds },
  });

  // 📊 thống kê
  let totalBookings = bookings.length;
  let pending = 0;
  let confirmed = 0;
  let cancelled = 0;
  let revenue = 0;

  bookings.forEach((b) => {
    if (b.status === BookingStatusEnum.PENDING) pending++;
    if (
      b.status === BookingStatusEnum.CONFIRMED ||
      b.status === BookingStatusEnum.COMPLETED
    ) {
      confirmed++;
      revenue += b.totalPrice;
    }
    if (b.status === BookingStatusEnum.CANCELLED) cancelled++;
  });

  const totalFields = fieldIds.length;

  return res.status(200).json({
    status: 200,
    code: "200",
    message: "success",
    data: {
      totalFields,
      totalBookings,
      pendingBookings: pending,
      confirmedBookings: confirmed,
      cancelledBookings: cancelled,
      totalRevenue: revenue,
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

    if (
      String(booking.depositStatus || "")
        .trim()
        .toUpperCase() === DepositStatusEnum.PAID
    ) {
      throw ErrorHelper.forbidden("Chỉ có thể hủy booking chưa thanh toán");
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
    )
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label");
    const latestPaymentsByBookingId = await getLatestPaymentsByBookingIds(
      bookings
        .map((booking) => toObjectId(booking?._id))
        .filter((bookingId): bookingId is Types.ObjectId => Boolean(bookingId)),
    );

    const bookedTimeSlotIds = bookings
      .map((booking) => {
        const bookingObject =
          booking && typeof booking.toObject === "function"
            ? booking.toObject()
            : booking;
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
          serializeBooking(booking, latestPaymentsByBookingId),
        ),
      },
    });
  }
}

export default new BookingRoute().router;
