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
import {
  PaymentStatusEnum,
  PaymentMethodEnum,
  BookingStatusEnum,
  DepositStatusEnum,
} from "../../constants/model.const";

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
    const { bookingId, method } = req.body;

    if (!bookingId || !method) {
      throw ErrorHelper.requestDataInvalid("Thiếu dữ liệu");
    }

    if (!Types.ObjectId.isValid(bookingId)) {
      throw ErrorHelper.requestDataInvalid("bookingId không hợp lệ");
    }

    const booking = await BookingModel.findOne({
      _id: bookingId,
      isDeleted: false,
    });

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    if (booking.depositStatus === DepositStatusEnum.PAID) {
      throw ErrorHelper.forbidden("Đã thanh toán rồi");
    }

    const payment = new PaymentModel({
      bookingId: booking._id,
      userId: req.tokenInfo._id,
      amount: booking.depositAmount,
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

    payment.status = PaymentStatusEnum.PAID;
    await payment.save();

    const booking = await BookingModel.findById(payment.bookingId);

    if (!booking) throw ErrorHelper.forbidden("Booking không tồn tại");

    booking.depositStatus = DepositStatusEnum.PAID;
    booking.status = BookingStatusEnum.CONFIRMED;

    await booking.save();

    return res.json({
      status: 200,
      message: "Thanh toán thành công",
    });
  }

  async getMyPayments(req: Request, res: Response) {
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

    const payments = await PaymentModel.find({
      bookingId: bookingId,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    return res.json({
      status: 200,
      data: payments,
    });
  }

  async cancelPayment(req: Request, res: Response) {
    const { id } = req.params;

    const payment = await PaymentModel.findById(id);

    if (!payment) throw ErrorHelper.forbidden("Không tìm thấy payment");

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

    const qr = await QRCodeModel.findOne({
      paymentId:paymentId,
    });

    if (!qr) throw ErrorHelper.forbidden("QR không tồn tại");

    return res.json({
      status: 200,
      data: qr,
    });
  }
}

export default new PaymentRoute().router;