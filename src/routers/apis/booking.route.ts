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

const buildCustomerInfo = (booking: any) => {
  const user = booking?.userId && typeof booking.userId === "object" ? booking.userId : null;

  return {
    id: String(user?._id || booking?.userId || "").trim(),
    fullName: String(user?.name || "").trim() || "Khách hàng",
    email: String(user?.email || "").trim(),
    phone: String(booking?.phone || user?.phone || "").trim(),
    createdAt: user?.createdAt || null,
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
    depositPaid:
      String(rawBooking?.depositStatus || "").trim().toUpperCase() === DepositStatusEnum.PAID ||
      String(latestPayment?.status || "").trim().toUpperCase() === PaymentStatusEnum.PAID,
    fullyPaid: String(latestPayment?.status || "").trim().toUpperCase() === PaymentStatusEnum.PAID,
    depositPaidAt:
      String(rawBooking?.depositStatus || "").trim().toUpperCase() === DepositStatusEnum.PAID
        ? latestPayment?.updatedAt || latestPayment?.createdAt || rawBooking?.updatedAt || null
        : null,
    fullyPaidAt:
      String(latestPayment?.status || "").trim().toUpperCase() === PaymentStatusEnum.PAID
        ? latestPayment?.updatedAt || latestPayment?.createdAt || null
        : null,
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

  const [hours, minutes] = startTime.split(":").map((value) => Number.parseInt(value, 10));

  return hours * 60 + minutes;
};

const sortDashboardBookings = (bookings: any[] = []) =>
  [...bookings].sort((left, right) => {
    const leftDateKey = getBookingDateKey(left);
    const rightDateKey = getBookingDateKey(right);

    if (leftDateKey !== rightDateKey) {
      return leftDateKey.localeCompare(rightDateKey);
    }

    const timeSortDiff = getBookingTimeSortValue(left) - getBookingTimeSortValue(right);

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
  const status = String(booking?.status || "").trim().toUpperCase();
  const depositStatus = String(booking?.depositStatus || "").trim().toUpperCase();

  if (status === BookingStatusEnum.CANCELLED) {
    return false;
  }

  if (depositStatus === DepositStatusEnum.PAID) {
    return true;
  }

  if ([BookingStatusEnum.CONFIRMED, BookingStatusEnum.COMPLETED].includes(status as BookingStatusEnum)) {
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
  const customerId = String(booking?.customer?.id || booking?.userId || "").trim();

  if (customerId) {
    return `id:${customerId}`;
  }

  const email = String(booking?.customer?.email || "").trim().toLowerCase();

  if (email) {
    return `email:${email}`;
  }

  const phone = String(booking?.customer?.phone || "").trim();

  if (phone) {
    return `phone:${phone}`;
  }

  const fullName = String(booking?.customer?.fullName || "").trim().toLowerCase();

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
      .populate("fieldId", "name address slug district ownerUserId openHours")
      .populate("subFieldId", "name type key pricePerHour openHours")
      .populate("timeSlotId", "startTime endTime label")
      .populate("userId", "name email phone createdAt")
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

  async getDashboard(req: Request, res: Response) {
    if (![ROLES.ADMIN, ROLES.OWNER].includes(req.tokenInfo.role_)) {
      throw ErrorHelper.permissionDeny();
    }

    const availabilityDate = parseDashboardDate(req.query.date);
    const months = Math.min(
      toPositiveInteger(req.query.months, DEFAULT_DASHBOARD_MONTHS),
      24,
    );
    const recentLimit = Math.min(
      toPositiveInteger(req.query.recentLimit, DEFAULT_DASHBOARD_RECENT_LIMIT),
      100,
    );
    const managedLimit = Math.min(
      toPositiveInteger(req.query.managedLimit, DEFAULT_DASHBOARD_MANAGED_LIMIT),
      200,
    );
    const now = new Date();
    const emptyDashboardData: any = {
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
      availabilityDate,
      dailyAvailability: [],
      customerMonthlyStats: [],
      customerSummaries: [],
    };

    const fieldQuery: any = {
      isDeleted: false,
    };

    if (req.tokenInfo.role_ === ROLES.OWNER) {
      fieldQuery.ownerUserId = new Types.ObjectId(req.tokenInfo._id);
    }

    const fields = await FieldModel.find(fieldQuery).sort({ name: 1 });
    const fieldIds = fields
      .map((field) => toObjectId(field?._id))
      .filter((fieldId): fieldId is Types.ObjectId => Boolean(fieldId));

    if (!fieldIds.length) {
      return res.status(200).json({
        status: 200,
        code: "200",
        message: "success",
        data: emptyDashboardData,
      });
    }

    await expireStalePendingBookings(
      {
        fieldId: { $in: fieldIds },
      },
      now,
    );

    const [subFields, bookings] = await Promise.all([
      SubFieldModel.find({
        fieldId: { $in: fieldIds },
        isDeleted: false,
      }).sort({ name: 1 }),
      BookingModel.find({
        fieldId: { $in: fieldIds },
        isDeleted: false,
      })
        .populate("fieldId", "name address slug district ownerUserId openHours")
        .populate("subFieldId", "name type key pricePerHour openHours fieldId")
        .populate("timeSlotId", "startTime endTime label")
        .populate("userId", "name email phone createdAt")
        .sort({ createdAt: -1 }),
    ]);

    const latestPaymentsByBookingId = await getLatestPaymentsByBookingIds(
      bookings
        .map((booking) => toObjectId(booking?._id))
        .filter((bookingId): bookingId is Types.ObjectId => Boolean(bookingId)),
    );

    const serializedBookings = bookings.map((booking) =>
      serializeBooking(booking, latestPaymentsByBookingId),
    );
    const recentBookings = serializedBookings.slice(0, recentLimit);
    const managedBookings = sortDashboardBookings(
      serializedBookings.filter(
        (booking) => getBookingDateKey(booking) === availabilityDate,
      ),
    ).slice(0, managedLimit);
    const blockingBookingsForDate = sortDashboardBookings(
      serializedBookings.filter(
        (booking) =>
          getBookingDateKey(booking) === availabilityDate &&
          isBlockingDashboardBooking(booking, now),
      ),
    );

    const subFieldsByFieldId = new Map<string, any[]>();

    subFields.forEach((subField) => {
      const fieldId = String(subField?.fieldId || "").trim();

      if (!fieldId) {
        return;
      }

      const currentItems = subFieldsByFieldId.get(fieldId) || [];
      currentItems.push(subField);
      subFieldsByFieldId.set(fieldId, currentItems);
    });

    const blockingBookingsBySubFieldId = new Map<string, any[]>();

    blockingBookingsForDate.forEach((booking) => {
      const subFieldId = String(booking?.subFieldId || "").trim();

      if (!subFieldId) {
        return;
      }

      const currentItems = blockingBookingsBySubFieldId.get(subFieldId) || [];
      currentItems.push(booking);
      blockingBookingsBySubFieldId.set(subFieldId, currentItems);
    });

    const dailyAvailability = fields.map((field) => {
      const fieldId = String(field?._id || "").trim();
      const fieldSubFields = subFieldsByFieldId.get(fieldId) || [];
      let availableSubFields = 0;
      let bookingCount = 0;

      const dashboardSubFields = fieldSubFields.map((subField) => {
        const subFieldId = String(subField?._id || "").trim();
        const subFieldBookings = sortDashboardBookings(
          blockingBookingsBySubFieldId.get(subFieldId) || [],
        );
        const isAvailable = subFieldBookings.length === 0;

        if (isAvailable) {
          availableSubFields += 1;
        }

        bookingCount += subFieldBookings.length;

        return {
          key: String(subField?.key || "").trim(),
          name: String(subField?.name || "").trim(),
          type: String(subField?.type || "").trim(),
          pricePerHour: Number(subField?.pricePerHour || 0),
          isAvailable,
          bookings: subFieldBookings.map((booking) => ({
            id: String(booking?.id || booking?._id || "").trim(),
            timeSlot: String(booking?.timeSlot || booking?.timeSlotLabel || "").trim(),
            status: String(booking?.status || "").trim(),
            customerName: String(booking?.customer?.fullName || "").trim(),
            phone: String(booking?.customer?.phone || "").trim(),
          })),
        };
      });

      return {
        id: String(field?._id || "").trim(),
        name: String(field?.name || "").trim(),
        slug: String(field?.slug || "").trim(),
        address: String(field?.address || "").trim(),
        district: String(field?.district || "").trim(),
        openHours: String(field?.openHours || "").trim(),
        totalSubFields: dashboardSubFields.length,
        availableSubFields,
        bookingCount,
        subFields: dashboardSubFields,
      };
    });

    const selectedDate = new Date(`${availabilityDate}T00:00:00.000Z`);
    const selectedMonthStart = new Date(
      Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1),
    );
    const monthKeys = Array.from({ length: months }).map((_, index) => {
      const monthDate = new Date(
        Date.UTC(
          selectedMonthStart.getUTCFullYear(),
          selectedMonthStart.getUTCMonth() - (months - index - 1),
          1,
        ),
      );

      return monthDate.toISOString().slice(0, 7);
    });

    const monthlyStatsMap = new Map<
      string,
      {
        monthKey: string;
        label: string;
        customerKeys: Set<string>;
        bookings: number;
        confirmedBookings: number;
        cancelledBookings: number;
        revenue: number;
      }
    >();

    monthKeys.forEach((monthKey) => {
      monthlyStatsMap.set(monthKey, {
        monthKey,
        label: getMonthLabel(monthKey),
        customerKeys: new Set<string>(),
        bookings: 0,
        confirmedBookings: 0,
        cancelledBookings: 0,
        revenue: 0,
      });
    });

    const customerSummaryMap = new Map<string, any>();
    let totalRevenue = 0;
    let totalDepositsPaid = 0;
    let pendingBookings = 0;
    let confirmedBookings = 0;
    let cancelledBookings = 0;

    serializedBookings.forEach((booking) => {
      const status = String(booking?.status || "").trim().toUpperCase();
      const bookingDateKey = getBookingDateKey(booking);
      const monthKey = getMonthKey(booking?.date);
      const customerKey =
        getCustomerIdentity(booking) ||
        `booking:${String(booking?.id || booking?._id || "").trim()}`;
      const totalPrice = Number(booking?.totalPrice || 0);
      const depositAmount = Number(booking?.depositAmount || 0);
      const isConfirmedBooking = [
        BookingStatusEnum.CONFIRMED,
        BookingStatusEnum.COMPLETED,
      ].includes(status as BookingStatusEnum);
      const isCancelledBooking = status === BookingStatusEnum.CANCELLED;

      if (status === BookingStatusEnum.PENDING) {
        pendingBookings += 1;
      }

      if (isConfirmedBooking) {
        confirmedBookings += 1;
        totalRevenue += totalPrice;
      }

      if (isCancelledBooking) {
        cancelledBookings += 1;
      }

      if (booking?.depositPaid) {
        totalDepositsPaid += depositAmount;
      }

      const monthlyStats = monthlyStatsMap.get(monthKey);

      if (monthlyStats) {
        monthlyStats.bookings += 1;

        if (customerKey) {
          monthlyStats.customerKeys.add(customerKey);
        }

        if (isConfirmedBooking) {
          monthlyStats.confirmedBookings += 1;
          monthlyStats.revenue += totalPrice;
        }

        if (isCancelledBooking) {
          monthlyStats.cancelledBookings += 1;
        }
      }

      const currentSummary = customerSummaryMap.get(customerKey) || {
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

      if (!currentSummary.fullName) {
        currentSummary.fullName = String(booking?.customer?.fullName || "").trim();
      }

      if (!currentSummary.email) {
        currentSummary.email = String(booking?.customer?.email || "").trim();
      }

      if (!currentSummary.phone) {
        currentSummary.phone = String(booking?.customer?.phone || "").trim();
      }

      if (!currentSummary.id) {
        currentSummary.id = String(booking?.customer?.id || "").trim();
      }

      if (isConfirmedBooking) {
        currentSummary.confirmedBookings += 1;
        currentSummary.totalSpent += totalPrice;
      }

      if (isCancelledBooking) {
        currentSummary.cancelledBookings += 1;
      }

      const candidateLastBookingAt =
        booking?.createdAt || booking?.updatedAt || booking?.date || null;
      const candidateTimestamp = candidateLastBookingAt
        ? new Date(candidateLastBookingAt).getTime()
        : 0;
      const currentTimestamp = currentSummary.lastBookingAt
        ? new Date(currentSummary.lastBookingAt).getTime()
        : 0;

      if (candidateTimestamp >= currentTimestamp) {
        currentSummary.lastBookingAt = candidateLastBookingAt;
        currentSummary.lastFieldName = String(booking?.fieldName || "").trim();
        currentSummary.lastTimeSlot = String(
          booking?.timeSlot || booking?.timeSlotLabel || "",
        ).trim();
        currentSummary.lastDate = bookingDateKey;
        currentSummary.lastStatus = String(booking?.status || "").trim();
      }

      customerSummaryMap.set(customerKey, currentSummary);
    });

    const customerMonthlyStats = monthKeys.map((monthKey) => {
      const monthlyStats = monthlyStatsMap.get(monthKey);

      return {
        monthKey,
        label: monthlyStats?.label || getMonthLabel(monthKey),
        uniqueCustomers: monthlyStats?.customerKeys.size || 0,
        bookings: monthlyStats?.bookings || 0,
        confirmedBookings: monthlyStats?.confirmedBookings || 0,
        cancelledBookings: monthlyStats?.cancelledBookings || 0,
        revenue: monthlyStats?.revenue || 0,
      };
    });

    const customerSummaries = Array.from(customerSummaryMap.values()).sort(
      (left, right) => {
        const leftTimestamp = left?.lastBookingAt
          ? new Date(left.lastBookingAt).getTime()
          : 0;
        const rightTimestamp = right?.lastBookingAt
          ? new Date(right.lastBookingAt).getTime()
          : 0;

        if (leftTimestamp !== rightTimestamp) {
          return rightTimestamp - leftTimestamp;
        }

        if (left.totalBookings !== right.totalBookings) {
          return right.totalBookings - left.totalBookings;
        }

        return String(left?.fullName || "").localeCompare(
          String(right?.fullName || ""),
          "vi",
        );
      },
    );

    return res.status(200).json({
      status: 200,
      code: "200",
      message: "success",
      data: {
        stats: {
          totalFields: fields.length,
          totalBookings: serializedBookings.length,
          pendingBookings,
          confirmedBookings,
          cancelledBookings,
          totalCustomers: customerSummaryMap.size,
          totalRevenue,
          totalDepositsPaid,
        },
        recentBookings,
        managedBookings,
        availabilityDate,
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
          serializeBooking(booking, latestPaymentsByBookingId),
        ),
      },
    });
  }
}

export default new BookingRoute().router;
