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
import { PaymentModel } from "../../models/Payment/payment.model";
import { QRCodeModel } from "../../models/qr/qr.model";
import { BookingModel } from "../../models/booking/booking.model";
import { Types } from "mongoose";
import { FieldModel } from "../../models/field/field.model";
import {
  PaymentStatusEnum,
  PaymentMethodEnum,
  BookingStatusEnum,
  DepositStatusEnum,
  DepositMethodEnum,
} from "../../constants/model.const";
import { expireStalePendingBookings } from "../../helper/bookingHold.helper";

const resolveObjectId = (value: any) => {
  const normalizedValue =
    value && typeof value === "object" && value._id ? value._id : value;

  if (!normalizedValue || !Types.ObjectId.isValid(normalizedValue)) {
    return null;
  }

  return new Types.ObjectId(normalizedValue);
};

const canManageBookingPayment = async (tokenInfo: any, booking: any) => {
  if (!booking) {
    return false;
  }

  if (tokenInfo.role_ === ROLES.ADMIN) {
    return true;
  }

  if (String(booking.userId || "") === String(tokenInfo._id || "")) {
    return true;
  }

  if (tokenInfo.role_ !== ROLES.OWNER) {
    return false;
  }

  const fieldId = resolveObjectId(booking.fieldId);
  if (!fieldId) {
    return false;
  }

  const field = await FieldModel.findOne({
    _id: fieldId,
    ownerUserId: tokenInfo._id,
    isDeleted: false,
  }).select("_id");

  return Boolean(field);
};

const normalizePaymentType = (value: any) => {
  const normalizedValue = String(value || "DEPOSIT").trim().toUpperCase();
  return normalizedValue === "FULL" ? "FULL" : "DEPOSIT";
};

const mapPaymentMethodToDepositMethod = (method: PaymentMethodEnum) => {
  switch (method) {
    case PaymentMethodEnum.MOMO:
      return DepositMethodEnum.MOMO;
    case PaymentMethodEnum.BANK:
      return DepositMethodEnum.BANK_TRANSFER;
    case PaymentMethodEnum.CASH:
    default:
      return DepositMethodEnum.CASH;
  }
};

class PaymentRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/createPayment", [this.authentication], this.route(this.createPayment));
    this.router.post("/confirmPayment", [this.authentication], this.route(this.confirmPayment));
    this.router.get("/getMyPayments", [this.authentication], this.route(this.getMyPayments));
    this.router.get("/getPaymentByBooking/:bookingId", [this.authentication], this.route(this.getPaymentByBooking));
    this.router.get("/cancelPayment/:id", [this.authentication], this.route(this.cancelPayment));
    this.router.get("/getQR/:paymentId", [this.authentication], this.route(this.getQR));
  }

  async authentication(req: Request, res: Response, next: NextFunction) {
    try {
      const token = req.get("x-token");
      if (!token) throw ErrorHelper.unauthorized();

      const tokenData: any = TokenHelper.decodeToken(token);

      if (![ROLES.ADMIN, ROLES.USER, ROLES.OWNER].includes(tokenData.role_)) {
        throw ErrorHelper.permissionDeny();
      }

      const user = await UserModel.findById(tokenData._id);
      if (!user) throw ErrorHelper.unauthorized();

      req.tokenInfo = tokenData;
      next();
    } catch {
      throw ErrorHelper.unauthorized();
    }
  }

  async createPayment(req: Request, res: Response) {
    const { bookingId, method, paymentType } = req.body;

    if (!bookingId || !method) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
    }

    if (!Types.ObjectId.isValid(bookingId)) {
      throw ErrorHelper.requestDataInvalid("bookingId không hợp lệ");
    }

    let booking = await BookingModel.findOne({
      _id: bookingId,
      isDeleted: false,
    });

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
      throw ErrorHelper.permissionDeny();
    }

    await expireStalePendingBookings({ _id: booking._id }, new Date());

    booking = await BookingModel.findOne({
      _id: booking._id,
      isDeleted: false,
    });

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (booking.status === BookingStatusEnum.CANCELLED) {
      throw ErrorHelper.forbidden("Booking đã hết thời gian giữ chỗ");
    }

    if (booking.depositStatus === DepositStatusEnum.PAID) {
      throw ErrorHelper.forbidden("Đã thanh toán rồi");
    }

    const normalizedPaymentType = normalizePaymentType(paymentType);
    const paymentAmount =
      normalizedPaymentType === "FULL"
        ? Number(booking.totalPrice || 0)
        : Number(booking.depositAmount || 0);

    const existingPendingPayment = await PaymentModel.findOne({
      bookingId: booking._id,
      isDeleted: false,
      status: PaymentStatusEnum.PENDING,
    }).sort({ createdAt: -1 });

    if (existingPendingPayment) {
      if (Number(existingPendingPayment.amount || 0) !== paymentAmount) {
        existingPendingPayment.status = PaymentStatusEnum.FAILED;
        await existingPendingPayment.save();
      } else {
      const existingQr = await QRCodeModel.findOne({
        paymentId: existingPendingPayment._id,
      }).sort({ createdAt: -1 });

      return res.json({
        status: 200,
        message: "Payment đang chờ xử lý",
        data: {
          payment: existingPendingPayment,
          qr: existingQr || null,
        },
      });
      }
    }

    const payment = new PaymentModel({
      bookingId: booking._id,
      userId: req.tokenInfo._id,
      amount: paymentAmount,
      method: method as PaymentMethodEnum,
      status: PaymentStatusEnum.PENDING,
    });

    await payment.save();

    const qr = new QRCodeModel({
      paymentId: payment._id,
      qrImage: `https://fake-qr.com/${payment._id}`,
      expiredAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    await qr.save();

    return res.json({
      status: 200,
      message: "Tạo payment thành công",
      data: { payment, qr },
    });
  }

  async confirmPayment(req: Request, res: Response) {
    const { paymentId } = req.body;

    if (!paymentId) throw ErrorHelper.requestDataInvalid("Thiếu paymentId");

    const payment = await PaymentModel.findById(paymentId);

    if (!payment) throw ErrorHelper.forbidden("Payment không tồn tại");

    if (payment.status === PaymentStatusEnum.PAID) {
      throw ErrorHelper.forbidden("Đã thanh toán rồi");
    }

    let booking = await BookingModel.findById(payment.bookingId);

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
      throw ErrorHelper.permissionDeny();
    }

    await expireStalePendingBookings({ _id: booking._id }, new Date());

    booking = await BookingModel.findById(payment.bookingId);

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (booking.status === BookingStatusEnum.CANCELLED) {
      payment.status = PaymentStatusEnum.FAILED;
      await payment.save();
      throw ErrorHelper.forbidden("Booking đã hết thời gian giữ chỗ");
    }

    payment.status = PaymentStatusEnum.PAID;
    await payment.save();

    const paidAmount = Number(payment.amount || 0);
    const totalPrice = Number(booking.totalPrice || 0);
    const remainingAmount = Math.max(totalPrice - paidAmount, 0);

    booking.depositStatus = DepositStatusEnum.PAID;
    booking.depositMethod = mapPaymentMethodToDepositMethod(payment.method);
    booking.remainingAmount = remainingAmount;
    booking.status = BookingStatusEnum.CONFIRMED;
    booking.expiredAt = undefined;

    await booking.save();

    return res.json({
      status: 200,
      message: "Thanh toán thành công",
    });
  }

  async getMyPayments(req: Request, res: Response) {
    await expireStalePendingBookings(
      {
        userId: new Types.ObjectId(req.tokenInfo._id),
      },
      new Date(),
    );

    const payments = await PaymentModel.find({
      userId: new Types.ObjectId(req.tokenInfo._id),
      isDeleted: false,
    })
      .populate("bookingId")
      .sort({ createdAt: -1 });

    return res.json({
      status: 200,
      data: payments,
    });
  }

  async getPaymentByBooking(req: Request, res: Response) {
    const { bookingId } = req.params;

    if (!bookingId) {
      throw ErrorHelper.requestDataInvalid("bookingId không hợp lệ");
    }

    await expireStalePendingBookings(
      {
        _id: bookingId,
      },
      new Date(),
    );

    const booking = await BookingModel.findOne({
      _id: bookingId,
      isDeleted: false,
    });

    if (!booking) {
      throw ErrorHelper.forbidden("Booking không tồn tại");
    }

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
      throw ErrorHelper.permissionDeny();
    }

    const payments = await PaymentModel.find({
      bookingId: bookingId,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    return res.json({
      status: 200,
      code: "200",
      message: "success",
      data: { payments },
    });
  }

  async cancelPayment(req: Request, res: Response) {
    const { id } = req.params;

    const payment = await PaymentModel.findById(id);

    if (!payment) throw ErrorHelper.forbidden("Không tìm thấy payment");

    const booking = await BookingModel.findById(payment.bookingId);
    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
      throw ErrorHelper.permissionDeny();
    }

    if (payment.status === PaymentStatusEnum.PAID) {
      throw ErrorHelper.forbidden("Không thể huỷ payment đã thanh toán");
    }

    payment.status = PaymentStatusEnum.FAILED;
    await payment.save();

    return res.json({
      status: 200,
      message: "Đã huỷ payment",
    });
  }

  async getQR(req: Request, res: Response) {
    const { paymentId } = req.params;

    if (!paymentId) {
      throw ErrorHelper.requestDataInvalid("paymentId không hợp lệ");
    }

    const payment = await PaymentModel.findById(paymentId);
    if (!payment) throw ErrorHelper.forbidden("Payment không tồn tại");

    const booking = await BookingModel.findById(payment.bookingId);
    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
      throw ErrorHelper.permissionDeny();
    }

    const qr = await QRCodeModel.findOne({
      paymentId: paymentId,
    });

    if (!qr) throw ErrorHelper.forbidden("QR không tồn tại");

    return res.json({
      status: 200,
      data: qr,
    });
  }
}

export default new PaymentRoute().router;
