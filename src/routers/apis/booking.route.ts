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
  const rawRemainingAmountValue = rawBooking?.remainingAmount;
  const hasExplicitRemainingAmount =
    rawRemainingAmountValue !== null &&
    rawRemainingAmountValue !== undefined &&
    (typeof rawRemainingAmountValue !== "string" ||
      rawRemainingAmountValue.trim() !== "");
  const parsedRemainingAmount = hasExplicitRemainingAmount
    ? Number(rawRemainingAmountValue)
    : Number.NaN;
  const fallbackRemainingAmount = Math.max(
    Number(rawBooking?.totalPrice || 0) - Number(rawBooking?.depositAmount || 0),
    0,
  );
  const normalizedRemainingAmount = isFullyPaid
    ? 0
    : Number.isFinite(parsedRemainingAmount)
      ? Math.max(parsedRemainingAmount, 0)
      : String(rawBooking?.depositStatus || "")
          .trim()
          .toUpperCase() === DepositStatusEnum.PAID
        ? fallbackRemainingAmount
        : Math.max(Number(rawBooking?.totalPrice || 0), 0);

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
    remainingAmount: normalizedRemainingAmount,
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

const sortByCreatedAtDesc = (bookings: any[] = []) =>
  [...bookings].sort((left, right) => {
    const leftCreatedAt = new Date(left?.createdAt || 0).getTime();
    const rightCreatedAt = new Date(right?.createdAt || 0).getTime();
    return rightCreatedAt - leftCreatedAt;
  });

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
    const rawSubFieldId = String(req.body?.subFieldId || "").trim();
    const rawTimeSlotId = String(req.body?.timeSlotId || "").trim();
    const rawDate = String(req.body?.date || "").trim();
    const rawPhone = String(req.body?.phone || "").trim();
    const rawNote = String(req.body?.note || "").trim();

    if (!rawSubFieldId || !rawTimeSlotId || !rawDate || !rawPhone) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu bắt buộc");
    }

    if (!Types.ObjectId.isValid(rawSubFieldId)) {
      throw ErrorHelper.requestDataInvalid("subFieldId không hợp lệ");
    }

    if (!Types.ObjectId.isValid(rawTimeSlotId)) {
      throw ErrorHelper.requestDataInvalid("timeSlotId không hợp lệ");
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
      throw ErrorHelper.requestDataInvalid("Ngày đặt phải theo định dạng YYYY-MM-DD");
    }

    const subFieldObjectId = new Types.ObjectId(rawSubFieldId);
    const timeSlotObjectId = new Types.ObjectId(rawTimeSlotId);

    const subField = await SubFieldModel.findOne({
      _id: subFieldObjectId,
    });

    if (!subField) {
      throw ErrorHelper.forbidden("Sân con không tồn tại");
    }

    const field = await FieldModel.findOne({
      _id: subField.fieldId,
    });

    if (!field) {
      throw ErrorHelper.forbidden("Sân không tồn tại");
    }

    const fieldStatus = String(field?.status || "").trim().toUpperCase();
    if (
      fieldStatus === "PENDING" ||
      fieldStatus === "REJECTED"
    ) {
      throw ErrorHelper.requestDataInvalid("Sân chưa sẵn sàng để đặt");
    }

    if (fieldStatus === "LOCKED" || Boolean((field as any)?.isLocked)) {
      throw ErrorHelper.requestDataInvalid("Sân đang bị khóa, không thể đặt");
    }

    const timeSlot = await TimeSlotModel.findOne({
      _id: timeSlotObjectId,
    });

    if (!timeSlot) {
      throw ErrorHelper.forbidden("Khung giờ không tồn tại");
    }

    const bookingDate = new Date(rawDate);
    if (Number.isNaN(bookingDate.getTime())) {
      throw ErrorHelper.requestDataInvalid("Ngày đặt không hợp lệ");
    }

    const now = new Date();
    const nowVi = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayVi = `${nowVi.getUTCFullYear()}-${String(
      nowVi.getUTCMonth() + 1,
    ).padStart(2, "0")}-${String(nowVi.getUTCDate()).padStart(2, "0")}`;

    if (rawDate < todayVi) {
      throw ErrorHelper.requestDataInvalid("Không thể đặt lịch trong quá khứ");
    }

    const slotStartMinutes = timeStringToMinutes(String(timeSlot?.startTime || ""));
    const nowViMinutes = nowVi.getUTCHours() * 60 + nowVi.getUTCMinutes();
    if (
      rawDate === todayVi &&
      Number.isFinite(slotStartMinutes) &&
      Number(slotStartMinutes) <= nowViMinutes
    ) {
      throw ErrorHelper.requestDataInvalid("Khung giờ đã qua, vui lòng chọn khung giờ khác");
    }

    await expireStalePendingBookings(
      {
        subFieldId: subFieldObjectId,
        timeSlotId: timeSlotObjectId,
        date: bookingDate,
      },
      now,
    );

    const existed = await BookingModel.findOne(
      buildActiveBookingFilter(
        {
          subFieldId: subFieldObjectId,
          timeSlotId: timeSlotObjectId,
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
        subFieldId: subFieldObjectId,
        timeSlotId: timeSlotObjectId,
        date: bookingDate,
        phone: rawPhone,
        note: rawNote,
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

    if (req.tokenInfo.role_ === ROLES.OWNER) {
      const ownerObjectId = new Types.ObjectId(req.tokenInfo._id);

      const fieldIds = await FieldModel.find({
        ownerUserId: ownerObjectId,
      }).distinct("_id");

      query.fieldId = { $in: fieldIds };
    } else if (req.tokenInfo.role_ === ROLES.USER) {
      query.userId = new Types.ObjectId(req.tokenInfo._id);
    }

    const bookings = await BookingModel.find(query)
      .populate("userId", "name email phone createdAt")
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label")
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
        bookings: sortByCreatedAtDesc(
          bookings.map((booking) =>
            serializeBooking(booking, latestPaymentsByBookingId),
          ),
        ),
      },
    });
  }

  async getDashboard(req: Request, res: Response) {
    if (![ROLES.ADMIN, ROLES.OWNER].includes(req.tokenInfo.role_)) {
      throw ErrorHelper.permissionDeny();
    }

    const selectedDate = parseDashboardDate(req.query?.date);
    const dashboardMonths = toPositiveInteger(
      req.query?.months,
      DEFAULT_DASHBOARD_MONTHS,
    );
    const recentLimit = toPositiveInteger(
      req.query?.recentLimit,
      DEFAULT_DASHBOARD_RECENT_LIMIT,
    );
    const managedLimit = toPositiveInteger(
      req.query?.managedLimit,
      DEFAULT_DASHBOARD_MANAGED_LIMIT,
    );

    const fieldQuery: any =
      req.tokenInfo.role_ === ROLES.OWNER
        ? {
            ownerUserId: new Types.ObjectId(req.tokenInfo._id),
          }
        : {};

    const fields = await FieldModel.find(fieldQuery).select(
      "_id name slug address district openHours ownerUserId",
    );
    const fieldIds = fields
      .map((field) => toObjectId(field?._id))
      .filter((fieldId): fieldId is Types.ObjectId => Boolean(fieldId));

    if (!fieldIds.length) {
      return res.status(200).json({
        status: 200,
        code: "200",
        message: "success",
        data: {
          stats: {
            totalFields: 0,
            totalBookings: 0,
            pendingBookings: 0,
            confirmedBookings: 0,
            cancelledBookings: 0,
            totalCustomers: 0,
            totalRevenue: 0,
            totalDepositsPaid: 0,
          },
          recentBookings: [],
          managedBookings: [],
          availabilityDate: selectedDate,
          dailyAvailability: [],
          customerMonthlyStats: [],
          customerSummaries: [],
        },
      });
    }

    const now = new Date();
    await expireStalePendingBookings(
      {
        fieldId: { $in: fieldIds },
      },
      now,
    );

    const bookings = await BookingModel.find({
      fieldId: { $in: fieldIds },
    })
      .populate("userId", "name email phone createdAt")
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label")
      .sort({ createdAt: -1 });

    const latestPaymentsByBookingId = await getLatestPaymentsByBookingIds(
      bookings
        .map((booking) => toObjectId(booking?._id))
        .filter((bookingId): bookingId is Types.ObjectId => Boolean(bookingId)),
    );

    const serializedBookings = bookings.map((booking) =>
      serializeBooking(booking, latestPaymentsByBookingId),
    );
    const sortedDashboardBookings = sortDashboardBookings(serializedBookings);
    const recentBookings = sortByCreatedAtDesc(serializedBookings).slice(
      0,
      recentLimit,
    );
    const managedBookings = sortedDashboardBookings
      .filter(
        (booking) =>
          getBookingDateKey(booking) === selectedDate &&
          isBlockingDashboardBooking(booking, now),
      )
      .slice(0, managedLimit);

    let pendingBookings = 0;
    let confirmedBookings = 0;
    let cancelledBookings = 0;
    let totalRevenue = 0;
    let totalDepositsPaid = 0;
    const customerKeys = new Set<string>();
    const monthlyStatsMap = new Map<
      string,
      {
        customerKeys: Set<string>;
        bookings: number;
        confirmedBookings: number;
        cancelledBookings: number;
        revenue: number;
      }
    >();
    const customerSummariesMap = new Map<
      string,
      {
        key: string;
        id: string;
        fullName: string;
        email: string;
        phone: string;
        totalBookings: number;
        confirmedBookings: number;
        cancelledBookings: number;
        totalSpent: number;
        lastBookingAt: string | null;
        lastFieldName: string;
        lastTimeSlot: string;
        lastDate: string;
        lastStatus: string;
      }
    >();

    serializedBookings.forEach((booking) => {
      const status = String(booking?.status || "")
        .trim()
        .toUpperCase();
      const bookingAmount = Number(booking?.totalPrice || 0);
      const bookingDateKey = getBookingDateKey(booking);
      const customerKey = getCustomerIdentity(booking);

      if (status === BookingStatusEnum.PENDING) {
        pendingBookings += 1;
      } else if (status === BookingStatusEnum.CANCELLED) {
        cancelledBookings += 1;
      } else if (
        status === BookingStatusEnum.CONFIRMED ||
        status === BookingStatusEnum.COMPLETED
      ) {
        confirmedBookings += 1;
        totalRevenue += bookingAmount;
      }

      if (
        String(booking?.depositStatus || "")
          .trim()
          .toUpperCase() === DepositStatusEnum.PAID
      ) {
        totalDepositsPaid += Number(booking?.depositAmount || 0);
      }

      if (customerKey) {
        customerKeys.add(customerKey);

        const currentSummary = customerSummariesMap.get(customerKey) || {
          key: customerKey,
          id: String(booking?.customer?.id || "").trim(),
          fullName: String(booking?.customer?.fullName || "").trim(),
          email: String(booking?.customer?.email || "").trim(),
          phone: String(booking?.customer?.phone || "").trim(),
          totalBookings: 0,
          confirmedBookings: 0,
          cancelledBookings: 0,
          totalSpent: 0,
          lastBookingAt: null,
          lastFieldName: "",
          lastTimeSlot: "",
          lastDate: "",
          lastStatus: "",
        };

        currentSummary.totalBookings += 1;
        if (
          status === BookingStatusEnum.CONFIRMED ||
          status === BookingStatusEnum.COMPLETED
        ) {
          currentSummary.confirmedBookings += 1;
          currentSummary.totalSpent += bookingAmount;
        }
        if (status === BookingStatusEnum.CANCELLED) {
          currentSummary.cancelledBookings += 1;
        }

        const bookingCreatedAt = booking?.createdAt
          ? new Date(booking.createdAt)
          : null;
        const currentLastBookingAt = currentSummary.lastBookingAt
          ? new Date(currentSummary.lastBookingAt)
          : null;
        const shouldUpdateLastBooking =
          bookingCreatedAt &&
          !Number.isNaN(bookingCreatedAt.getTime()) &&
          (!currentLastBookingAt ||
            Number.isNaN(currentLastBookingAt.getTime()) ||
            bookingCreatedAt.getTime() > currentLastBookingAt.getTime());

        if (shouldUpdateLastBooking) {
          currentSummary.lastBookingAt = bookingCreatedAt!.toISOString();
          currentSummary.lastFieldName = String(booking?.fieldName || "").trim();
          currentSummary.lastTimeSlot = String(
            booking?.timeSlotLabel || booking?.timeSlot || "",
          ).trim();
          currentSummary.lastDate = bookingDateKey;
          currentSummary.lastStatus = String(booking?.status || "")
            .trim()
            .toLowerCase();
        }

        customerSummariesMap.set(customerKey, currentSummary);
      }

      const monthKey = getMonthKey(booking?.date);
      if (monthKey) {
        const currentMonthlyStats = monthlyStatsMap.get(monthKey) || {
          customerKeys: new Set<string>(),
          bookings: 0,
          confirmedBookings: 0,
          cancelledBookings: 0,
          revenue: 0,
        };

        currentMonthlyStats.bookings += 1;
        if (
          status === BookingStatusEnum.CONFIRMED ||
          status === BookingStatusEnum.COMPLETED
        ) {
          currentMonthlyStats.confirmedBookings += 1;
          currentMonthlyStats.revenue += bookingAmount;
        }
        if (status === BookingStatusEnum.CANCELLED) {
          currentMonthlyStats.cancelledBookings += 1;
        }
        if (customerKey) {
          currentMonthlyStats.customerKeys.add(customerKey);
        }

        monthlyStatsMap.set(monthKey, currentMonthlyStats);
      }
    });

    const allSubFields = await SubFieldModel.find({
      fieldId: { $in: fieldIds },
      isDeleted: { $ne: true },
    }).sort({ createdAt: 1 });

    const subFieldsByFieldId = new Map<string, any[]>();
    allSubFields.forEach((subField) => {
      const normalizedFieldId = String(subField?.fieldId || "").trim();
      if (!normalizedFieldId) {
        return;
      }

      const currentSubFields = subFieldsByFieldId.get(normalizedFieldId) || [];
      currentSubFields.push(subField);
      subFieldsByFieldId.set(normalizedFieldId, currentSubFields);
    });

    const selectedDateBookings = sortedDashboardBookings.filter(
      (booking) => getBookingDateKey(booking) === selectedDate,
    );
    const blockingBookingsBySubFieldId = new Map<string, any[]>();
    selectedDateBookings.forEach((booking) => {
      if (!isBlockingDashboardBooking(booking, now)) {
        return;
      }

      const subFieldId = String(booking?.subFieldId || "").trim();
      if (!subFieldId) {
        return;
      }

      const currentBookings = blockingBookingsBySubFieldId.get(subFieldId) || [];
      currentBookings.push(booking);
      blockingBookingsBySubFieldId.set(subFieldId, currentBookings);
    });

    const dailyAvailability = fields.map((field) => {
      const normalizedFieldId = String(field?._id || "").trim();
      const fieldSubFields = subFieldsByFieldId.get(normalizedFieldId) || [];

      const serializedSubFields = fieldSubFields.map((subField) => {
        const normalizedSubFieldId = String(subField?._id || "").trim();
        const subFieldBookings =
          blockingBookingsBySubFieldId.get(normalizedSubFieldId) || [];

        return {
          key: String(subField?.key || "").trim(),
          name: String(subField?.name || "").trim(),
          type: String(subField?.type || "").trim(),
          pricePerHour: Number(subField?.pricePerHour || 0),
          isAvailable: subFieldBookings.length === 0,
          bookings: subFieldBookings.map((booking) => ({
            id: String(booking?.id || booking?._id || "").trim(),
            timeSlot: String(
              booking?.timeSlotLabel || booking?.timeSlot || "",
            ).trim(),
            status: String(booking?.status || "").trim().toLowerCase(),
            customerName: String(booking?.customer?.fullName || "").trim(),
            phone: String(booking?.customer?.phone || booking?.phone || "")
              .trim(),
          })),
        };
      });

      const availableSubFields = serializedSubFields.filter(
        (subField) => subField.isAvailable,
      ).length;
      const bookingCount = serializedSubFields.reduce(
        (sum, subField) => sum + Number(subField?.bookings?.length || 0),
        0,
      );

      return {
        id: String(field?._id || "").trim(),
        name: String(field?.name || "").trim(),
        slug: String(field?.slug || "").trim(),
        address: String(field?.address || "").trim(),
        district: String(field?.district || "").trim(),
        openHours: String(field?.openHours || "").trim(),
        totalSubFields: serializedSubFields.length,
        availableSubFields,
        bookingCount,
        subFields: serializedSubFields,
      };
    });

    const customerMonthlyStats = Array.from(monthlyStatsMap.entries())
      .sort(([leftMonth], [rightMonth]) => rightMonth.localeCompare(leftMonth))
      .slice(0, dashboardMonths)
      .map(([monthKey, value]) => ({
        monthKey,
        label: getMonthLabel(monthKey),
        uniqueCustomers: value.customerKeys.size,
        bookings: value.bookings,
        confirmedBookings: value.confirmedBookings,
        cancelledBookings: value.cancelledBookings,
        revenue: Math.round(value.revenue),
      }));

    const customerSummaries = Array.from(customerSummariesMap.values())
      .sort((left, right) => {
        if (right.totalBookings !== left.totalBookings) {
          return right.totalBookings - left.totalBookings;
        }

        const leftLastBookingAt = new Date(left.lastBookingAt || 0).getTime();
        const rightLastBookingAt = new Date(right.lastBookingAt || 0).getTime();
        return rightLastBookingAt - leftLastBookingAt;
      })
      .slice(0, managedLimit);

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        stats: {
          totalFields: fieldIds.length,
          totalBookings: serializedBookings.length,
          pendingBookings,
          confirmedBookings,
          cancelledBookings,
          totalCustomers: customerKeys.size,
          totalRevenue: Math.round(totalRevenue),
          totalDepositsPaid: Math.round(totalDepositsPaid),
        },
        recentBookings,
        managedBookings,
        availabilityDate: selectedDate,
        dailyAvailability,
        customerMonthlyStats,
        customerSummaries,
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

    const latestBooking = await BookingModel.findOne({
      _id: booking._id,
    })
      .populate("userId", "name email phone createdAt")
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label");
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
        booking: latestBooking
          ? serializeBooking(latestBooking, latestPaymentsByBookingId)
          : undefined,
      },
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
    }

    await booking.save();

    const latestBooking = await BookingModel.findOne({
      _id: booking._id,
    })
      .populate("userId", "name email phone createdAt")
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label");
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
        booking: latestBooking
          ? serializeBooking(latestBooking, latestPaymentsByBookingId)
          : booking,
      },
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
