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

// --- CẤU HÌNH NGÂN HÀNG CỦA BẠN ---
const BANK_CONFIG = {
  BANK_ID: "MB", // Ví dụ: MB, VCB, ICB (Vietinbank),...
  ACCOUNT_NO: "0987654321", // Số tài khoản nhận tiền
  ACCOUNT_NAME: "NGUYEN VAN A", // Tên chủ tài khoản (VIET HOA KHONG DAU)
};

const resolveObjectId = (value: any) => {
  const normalizedValue = value && typeof value === "object" && value._id ? value._id : value;
  if (!normalizedValue || !Types.ObjectId.isValid(normalizedValue)) return null;
  return new Types.ObjectId(normalizedValue);
};

const canManageBookingPayment = async (tokenInfo: any, booking: any) => {
  if (!booking) return false;
  if (tokenInfo.role_ === ROLES.ADMIN) return true;
  if (String(booking.userId || "") === String(tokenInfo._id || "")) return true;
  if (tokenInfo.role_ !== ROLES.OWNER) return false;

  const fieldId = resolveObjectId(booking.fieldId);
  if (!fieldId) return false;

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
    case PaymentMethodEnum.MOMO: return DepositMethodEnum.MOMO;
    case PaymentMethodEnum.BANK: return DepositMethodEnum.BANK_TRANSFER;
    default: return DepositMethodEnum.CASH;
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

    if (!bookingId || !method) throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu bookingId hoặc phương thức");

    let booking = await BookingModel.findOne({ _id: bookingId, isDeleted: false });
    if (!booking) throw ErrorHelper.forbidden("Đơn đặt sân không tồn tại");

    if (!(await canManageBookingPayment(req.tokenInfo, booking))) throw ErrorHelper.permissionDeny();

    // Kiểm tra xem đơn đã bị hết hạn giữ chỗ chưa
    await expireStalePendingBookings({ _id: booking._id }, new Date());
    booking = await BookingModel.findById(booking._id);
    if (booking?.status === BookingStatusEnum.CANCELLED) throw ErrorHelper.forbidden("Đơn đặt sân đã bị hủy do hết thời gian chờ");

    const normalizedType = normalizePaymentType(paymentType);
    
    // TÍNH TOÁN SỐ TIỀN: Cọc 50% hoặc Trả hết 100%
    const paymentAmount = normalizedType === "FULL" 
        ? Number(booking.totalPrice) 
        : (booking.depositAmount && booking.depositAmount > 0 ? booking.depositAmount : Number(booking.totalPrice) / 2);

    // Xử lý nếu đã có yêu cầu thanh toán cũ đang treo
    const existingPayment = await PaymentModel.findOne({
      bookingId: booking._id,
      status: PaymentStatusEnum.PENDING,
      isDeleted: false
    });

    if (existingPayment) {
        // Nếu số tiền khác (do khách đổi từ cọc sang trả đủ), hủy cái cũ
        if (existingPayment.amount !== paymentAmount) {
            existingPayment.status = PaymentStatusEnum.FAILED;
            await existingPayment.save();
        } else {
            // Nếu giống tiền, trả về QR cũ luôn
            const qr = await QRCodeModel.findOne({ paymentId: existingPayment._id });
            return res.json({ status: 200, data: { payment: existingPayment, qr } });
        }
    }

    // 1. Tạo bản ghi Payment
    const payment = new PaymentModel({
      bookingId: booking._id,
      userId: req.tokenInfo._id,
      amount: paymentAmount,
      method: method,
      status: PaymentStatusEnum.PENDING,
    });
    await payment.save();

    // 2. Tạo nội dung chuyển khoản chuẩn
    const description = `THANH TOAN ${booking._id.toString().slice(-6)}`.toUpperCase();

    // 3. Tạo link QR VietQR thật
    const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${paymentAmount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;

    const qr = new QRCodeModel({
      paymentId: payment._id,
      qrImage: qrUrl,
      expiredAt: new Date(Date.now() + 15 * 60 * 1000), // QR hiệu lực 15 phút
    });
    await qr.save();

    return res.json({
      status: 200,
      message: "Khởi tạo thanh toán thành công",
      data: { payment, qr, amount: paymentAmount, type: normalizedType }
    });
  }

  async confirmPayment(req: Request, res: Response) {
    const { paymentId } = req.body;
    const payment = await PaymentModel.findById(paymentId);
    if (!payment || payment.status === PaymentStatusEnum.PAID) throw ErrorHelper.forbidden("Thanh toán không hợp lệ hoặc đã hoàn tất");

    const booking = await BookingModel.findById(payment.bookingId);
    if (!booking) throw ErrorHelper.forbidden("Đơn hàng không tồn tại");

    // Xác nhận thanh toán
    payment.status = PaymentStatusEnum.PAID;
    await payment.save();

    // Cập nhật đơn đặt sân sang trạng thái Đã xác nhận (CONFIRMED)
    const paidAmount = Number(payment.amount);
    booking.depositStatus = DepositStatusEnum.PAID;
    booking.depositMethod = mapPaymentMethodToDepositMethod(payment.method as PaymentMethodEnum);
    booking.remainingAmount = Math.max(Number(booking.totalPrice) - paidAmount, 0);
    booking.status = BookingStatusEnum.CONFIRMED;
    booking.expiredAt = undefined; // Hủy thời gian đếm ngược giữ chỗ

    await booking.save();

    return res.json({ status: 200, message: "Xác nhận thanh toán thành công, sân đã được giữ" });
  }

  async getMyPayments(req: Request, res: Response) {
    const payments = await PaymentModel.find({
      userId: new Types.ObjectId(req.tokenInfo._id),
      isDeleted: false,
    }).populate("bookingId").sort({ createdAt: -1 });
    return res.json({ status: 200, data: payments });
  }

  async getPaymentByBooking(req: Request, res: Response) {
    const { bookingId } = req.params;
    const payments = await PaymentModel.find({
      bookingId: new Types.ObjectId(bookingId),
      isDeleted: false,
    }).sort({ createdAt: -1 });
    return res.json({ status: 200, data: { payments } });
  }

  async cancelPayment(req: Request, res: Response) {
    const { id } = req.params;
    const payment = await PaymentModel.findById(id);
    if (!payment || payment.status === PaymentStatusEnum.PAID) throw ErrorHelper.forbidden("Không thể hủy");
    payment.status = PaymentStatusEnum.FAILED;
    await payment.save();
    return res.json({ status: 200, message: "Đã hủy yêu cầu thanh toán" });
  }

  async getQR(req: Request, res: Response) {
    const { paymentId } = req.params;
    const qr = await QRCodeModel.findOne({ paymentId: new Types.ObjectId(paymentId) });
    if (!qr) throw ErrorHelper.forbidden("Không tìm thấy QR");
    return res.json({ status: 200, data: qr });
  }
}

export default new PaymentRoute().router;