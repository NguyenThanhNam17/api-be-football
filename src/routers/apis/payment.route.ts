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
import * as crypto from "crypto";
import * as https from "https";
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
import { BOOKING_HOLD_DURATION_MS, expireStalePendingBookings } from "../../helper/bookingHold.helper";

const BANK_CONFIG = {
  BANK_ID: "MB",
  ACCOUNT_NO: "0987654321",
  ACCOUNT_NAME: "NGUYEN VAN A",
};

const MOMO_CONFIG = {
  apiBaseUrl: String(process.env.MOMO_API_BASE_URL || "https://test-payment.momo.vn").trim().replace(/\/+$/g, ""),
  partnerCode: String(process.env.MOMO_PARTNER_CODE || "").trim(),
  accessKey: String(process.env.MOMO_ACCESS_KEY || "").trim(),
  secretKey: String(process.env.MOMO_SECRET_KEY || "").trim(),
  partnerName: String(process.env.MOMO_PARTNER_NAME || process.env.APP_NAME || "Football Booking").trim(),
  storeId: String(process.env.MOMO_STORE_ID || "FootballBooking").trim(),
  redirectUrl: String(process.env.MOMO_REDIRECT_URL || "https://example.com/momo-return").trim(),
  ipnUrl: String(process.env.MOMO_IPN_URL || "https://example.com/momo-ipn").trim(),
  lang: String(process.env.MOMO_LANG || "vi").trim() || "vi",
};

const resolveObjectId = (value: any) => {
  const normalizedValue = value && typeof value === "object" && value._id ? value._id : value;
  if (!normalizedValue || !Types.ObjectId.isValid(normalizedValue)) return null;
  return new Types.ObjectId(normalizedValue);
};

const normalizeRequestedBookingIds = (bookingIdValue: any, bookingIdsValue: any) => {
  const uniqueIds = new Set<string>();

  [bookingIdValue, ...(Array.isArray(bookingIdsValue) ? bookingIdsValue : [])].forEach((value) => {
    const objectId = resolveObjectId(value);
    if (objectId) {
      uniqueIds.add(String(objectId));
    }
  });

  return Array.from(uniqueIds).map((value) => new Types.ObjectId(value));
};

const mapOrderedBookings = (bookings: any[] = [], bookingIds: Types.ObjectId[] = []) => {
  const bookingMap = new Map(
    bookings.map((booking) => [String(booking?._id || "").trim(), booking]),
  );

  return bookingIds
    .map((bookingId) => bookingMap.get(String(bookingId || "").trim()))
    .filter(Boolean);
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

const getPaymentBookingIds = (payment: any) =>
  normalizeRequestedBookingIds(payment?.bookingId, payment?.bookingIds);

const calculatePaymentAmountForBooking = (booking: any, paymentType: string) => {
  const totalPrice = Number(booking?.totalPrice || 0);
  const depositAmount = Number(booking?.depositAmount || 0);

  if (normalizePaymentType(paymentType) === "FULL") {
    return totalPrice;
  }

  return depositAmount > 0 ? depositAmount : totalPrice / 2;
};

const calculatePaymentAmountForBookings = (bookings: any[] = [], paymentType: string) =>
  bookings.reduce(
    (sum, booking) => sum + calculatePaymentAmountForBooking(booking, paymentType),
    0,
  );

const haveSameBookingIds = (left: Types.ObjectId[] = [], right: Types.ObjectId[] = []) => {
  if (left.length !== right.length) {
    return false;
  }

  const leftIds = new Set(left.map((bookingId) => String(bookingId || "").trim()));
  return right.every((bookingId) => leftIds.has(String(bookingId || "").trim()));
};

const inferStoredPaymentType = (payment: any, bookings: any[] = []) => {
  const storedPaymentType = String(payment?.paymentType || "").trim().toUpperCase();
  if (storedPaymentType === "FULL" || storedPaymentType === "DEPOSIT") {
    return storedPaymentType;
  }

  if (!bookings.length) {
    return "DEPOSIT";
  }

  const fullAmount = calculatePaymentAmountForBookings(bookings, "FULL");
  return Math.round(Number(payment?.amount || 0)) >= Math.round(fullAmount) ? "FULL" : "DEPOSIT";
};

const mapPaymentMethodToDepositMethod = (method: PaymentMethodEnum) => {
  switch (method) {
    case PaymentMethodEnum.MOMO: return DepositMethodEnum.MOMO;
    case PaymentMethodEnum.BANK: return DepositMethodEnum.BANK_TRANSFER;
    default: return DepositMethodEnum.CASH;
  }
};

const ensureMomoConfigured = () => {
  if (!MOMO_CONFIG.partnerCode || !MOMO_CONFIG.accessKey || !MOMO_CONFIG.secretKey) {
    throw ErrorHelper.forbidden(
      "Chua cau hinh MoMo sandbox. Vui long them MOMO_PARTNER_CODE, MOMO_ACCESS_KEY va MOMO_SECRET_KEY vao .env backend.",
    );
  }
};

const createHmacSha256 = (data: string, secretKey: string) =>
  crypto.createHmac("sha256", secretKey).update(data).digest("hex");

const postJson = async (url: string, payload: Record<string, any>) => {
  const body = JSON.stringify(payload);
  const parsedUrl = new URL(url);

  return new Promise<any>((resolve, reject) => {
    const request = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let rawData = "";

        response.on("data", (chunk) => {
          rawData += String(chunk || "");
        });

        response.on("end", () => {
          try {
            const parsedData = rawData ? JSON.parse(rawData) : {};
            resolve(parsedData);
          } catch (error) {
            reject(error);
          }
        });
      },
    );

    request.setTimeout(30000, () => {
      request.destroy(new Error("MoMo request timeout"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
};

const buildMomoCreateSignature = (params: {
  amount: number;
  extraData: string;
  ipnUrl: string;
  orderId: string;
  orderInfo: string;
  partnerCode: string;
  redirectUrl: string;
  requestId: string;
  requestType: string;
}) =>
  `accessKey=${MOMO_CONFIG.accessKey}&amount=${params.amount}&extraData=${params.extraData}`
  + `&ipnUrl=${params.ipnUrl}&orderId=${params.orderId}&orderInfo=${params.orderInfo}`
  + `&partnerCode=${params.partnerCode}&redirectUrl=${params.redirectUrl}`
  + `&requestId=${params.requestId}&requestType=${params.requestType}`;

const buildMomoQuerySignature = (params: {
  orderId: string;
  partnerCode: string;
  requestId: string;
}) =>
  `accessKey=${MOMO_CONFIG.accessKey}&orderId=${params.orderId}`
  + `&partnerCode=${params.partnerCode}&requestId=${params.requestId}`;

const buildMomoIpnSignature = (params: {
  amount: number | string;
  extraData: string;
  message: string;
  orderId: string;
  orderInfo: string;
  orderType: string;
  partnerCode: string;
  payType: string;
  requestId: string;
  responseTime: number | string;
  resultCode: number | string;
  transId: number | string;
}) =>
  `accessKey=${MOMO_CONFIG.accessKey}&amount=${params.amount}&extraData=${params.extraData}`
  + `&message=${params.message}&orderId=${params.orderId}&orderInfo=${params.orderInfo}`
  + `&orderType=${params.orderType}&partnerCode=${params.partnerCode}&payType=${params.payType}`
  + `&requestId=${params.requestId}&responseTime=${params.responseTime}`
  + `&resultCode=${params.resultCode}&transId=${params.transId}`;

const createMomoOrderId = (paymentId: Types.ObjectId | string) =>
  `MOMO_${String(paymentId || "").trim()}`;

const createMomoRequestId = (paymentId: Types.ObjectId | string) =>
  `REQ_${Date.now()}_${String(paymentId || "").trim().slice(-6)}`;

const buildQrPreviewUrl = (qrPayload: string) =>
  qrPayload
    ? `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrPayload)}`
    : "";

const verifyMomoIpnSignature = (payload: any) => {
  if (!MOMO_CONFIG.accessKey || !MOMO_CONFIG.secretKey) {
    return false;
  }

  const providedSignature = String(payload?.signature || "").trim();
  if (!providedSignature) {
    return false;
  }

  const expectedSignature = createHmacSha256(
    buildMomoIpnSignature({
      amount: Number(payload?.amount || 0),
      extraData: String(payload?.extraData || ""),
      message: String(payload?.message || ""),
      orderId: String(payload?.orderId || ""),
      orderInfo: String(payload?.orderInfo || ""),
      orderType: String(payload?.orderType || ""),
      partnerCode: String(payload?.partnerCode || ""),
      payType: String(payload?.payType || ""),
      requestId: String(payload?.requestId || ""),
      responseTime: String(payload?.responseTime || ""),
      resultCode: String(payload?.resultCode ?? ""),
      transId: String(payload?.transId ?? ""),
    }),
    MOMO_CONFIG.secretKey,
  );

  return expectedSignature === providedSignature;
};

const createMomoPayment = async ({
  paymentId,
  amount,
  orderInfo,
}: {
  paymentId: Types.ObjectId | string;
  amount: number;
  orderInfo: string;
}) => {
  ensureMomoConfigured();

  const orderId = createMomoOrderId(paymentId);
  const requestId = createMomoRequestId(paymentId);
  const requestType = "captureWallet";
  const extraData = "";
  const signature = createHmacSha256(
    buildMomoCreateSignature({
      amount,
      extraData,
      ipnUrl: MOMO_CONFIG.ipnUrl,
      orderId,
      orderInfo,
      partnerCode: MOMO_CONFIG.partnerCode,
      redirectUrl: MOMO_CONFIG.redirectUrl,
      requestId,
      requestType,
    }),
    MOMO_CONFIG.secretKey,
  );

  const response = await postJson(`${MOMO_CONFIG.apiBaseUrl}/v2/gateway/api/create`, {
    partnerCode: MOMO_CONFIG.partnerCode,
    partnerName: MOMO_CONFIG.partnerName,
    storeId: MOMO_CONFIG.storeId,
    requestId,
    amount,
    orderId,
    orderInfo,
    redirectUrl: MOMO_CONFIG.redirectUrl,
    ipnUrl: MOMO_CONFIG.ipnUrl,
    lang: MOMO_CONFIG.lang,
    requestType,
    autoCapture: true,
    extraData,
    signature,
  });

  if (Number(response?.resultCode) !== 0) {
    throw ErrorHelper.forbidden(
      String(response?.message || "Khong the tao thanh toan MoMo sandbox."),
    );
  }

  return {
    orderId,
    response,
  };
};

const queryMomoPaymentStatus = async (orderId: string) => {
  ensureMomoConfigured();

  const requestId = createMomoRequestId(orderId);
  const signature = createHmacSha256(
    buildMomoQuerySignature({
      orderId,
      partnerCode: MOMO_CONFIG.partnerCode,
      requestId,
    }),
    MOMO_CONFIG.secretKey,
  );

  return postJson(`${MOMO_CONFIG.apiBaseUrl}/v2/gateway/api/query`, {
    partnerCode: MOMO_CONFIG.partnerCode,
    requestId,
    orderId,
    lang: MOMO_CONFIG.lang,
    signature,
  });
};

const applySuccessfulPayment = async (
  payment: any,
  orderedBookings: any[] = [],
  resolvedPaymentType: string,
) => {
  payment.status = PaymentStatusEnum.PAID;
  payment.paymentType = resolvedPaymentType as any;
  await payment.save();

  await Promise.all(
    orderedBookings.map(async (booking) => {
      const paidAmount = calculatePaymentAmountForBooking(booking, resolvedPaymentType);
      booking.depositStatus = DepositStatusEnum.PAID;
      booking.depositMethod = mapPaymentMethodToDepositMethod(payment.method as PaymentMethodEnum);
      booking.remainingAmount = Math.max(Number(booking.totalPrice) - paidAmount, 0);
      booking.status = BookingStatusEnum.CONFIRMED;
      booking.expiredAt = undefined;
      await booking.save();
    }),
  );

  return payment;
};

class PaymentRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/ipn/momo", this.route(this.handleMomoIpn));
    this.router.post("/createPayment", [this.authentication], this.route(this.createPayment));
    this.router.post("/confirmPayment", [this.authentication], this.route(this.confirmPayment));
    this.router.get("/checkStatus/:paymentId", [this.authentication], this.route(this.checkPaymentStatus));
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

  async handleMomoIpn(req: Request, res: Response) {
    try {
      const payload = req.body || {};
      const orderId = String(payload?.orderId || "").trim();
      const partnerCode = String(payload?.partnerCode || "").trim();
      const resultCode = Number(payload?.resultCode);
      const receivedAmount = Number(payload?.amount || 0);

      if (
        !orderId
        || partnerCode !== MOMO_CONFIG.partnerCode
        || !verifyMomoIpnSignature(payload)
      ) {
        return res.status(204).send();
      }

      const payment = await PaymentModel.findOne({
        transactionCode: orderId,
        isDeleted: false,
      });

      if (!payment) {
        return res.status(204).send();
      }

      if (Math.round(Number(payment.amount || 0)) !== Math.round(receivedAmount)) {
        return res.status(204).send();
      }

      if (payment.status === PaymentStatusEnum.PAID) {
        return res.status(204).send();
      }

      const paymentBookingIds = getPaymentBookingIds(payment);
      const bookings = await BookingModel.find({
        _id: { $in: paymentBookingIds },
        isDeleted: false,
      }).sort({ createdAt: 1 });
      const orderedBookings = mapOrderedBookings(bookings, paymentBookingIds);

      if (!orderedBookings.length || orderedBookings.length !== paymentBookingIds.length) {
        return res.status(204).send();
      }

      if (resultCode === 0) {
        const resolvedPaymentType = inferStoredPaymentType(payment, orderedBookings);
        await applySuccessfulPayment(payment, orderedBookings, resolvedPaymentType);
        return res.status(204).send();
      }

      if (resultCode !== 9000 && payment.status === PaymentStatusEnum.PENDING) {
        payment.status = PaymentStatusEnum.FAILED;
        await payment.save();
      }
    } catch (error) {
      console.error("MoMo IPN handling failed", error);
    }

    return res.status(204).send();
  }

  async createPayment(req: Request, res: Response) {
    const { bookingId, bookingIds, method, paymentType } = req.body;
    const targetBookingIds = normalizeRequestedBookingIds(bookingId, bookingIds);

    if (!targetBookingIds.length || !method) {
      throw ErrorHelper.requestDataInvalid("Thieu du lieu bookingId/bookingIds hoac phuong thuc");
    }

    let bookings = await BookingModel.find({
      _id: { $in: targetBookingIds },
      isDeleted: false,
    }).sort({ createdAt: 1 });
    let orderedBookings = mapOrderedBookings(bookings, targetBookingIds);

    if (!orderedBookings.length || orderedBookings.length !== targetBookingIds.length) {
      throw ErrorHelper.forbidden("Don dat san khong ton tai");
    }

    for (const booking of orderedBookings) {
      if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
        throw ErrorHelper.permissionDeny();
      }
    }

    await expireStalePendingBookings({ _id: { $in: targetBookingIds } }, new Date());
    bookings = await BookingModel.find({
      _id: { $in: targetBookingIds },
      isDeleted: false,
    }).sort({ createdAt: 1 });
    orderedBookings = mapOrderedBookings(bookings, targetBookingIds);

    if (
      orderedBookings.some(
        (booking) => String(booking?.status || "").trim().toUpperCase() === BookingStatusEnum.CANCELLED,
      )
    ) {
      throw ErrorHelper.forbidden("Don dat san da bi huy do het thoi gian cho");
    }

    const normalizedType = normalizePaymentType(paymentType);
    const paymentAmount = calculatePaymentAmountForBookings(orderedBookings, normalizedType);
    const requestedAmount = Number(
      req.body?.amount ?? req.body?.price ?? req.body?.paymentAmount,
    );

    if (
      Number.isFinite(requestedAmount) &&
      requestedAmount > 0 &&
      Math.round(requestedAmount) !== Math.round(paymentAmount)
    ) {
      throw ErrorHelper.requestDataInvalid(
        `So tien thanh toan khong hop le. He thong tinh duoc ${paymentAmount}.`,
      );
    }

    const existingPayments = await PaymentModel.find({
      $or: [
        { bookingId: { $in: targetBookingIds } },
        { bookingIds: { $in: targetBookingIds } },
      ],
      status: PaymentStatusEnum.PENDING,
      isDeleted: false,
    }).sort({ createdAt: -1 });

    for (const existingPayment of existingPayments) {
      const existingBookingIds = getPaymentBookingIds(existingPayment);
      const existingPaymentType = inferStoredPaymentType(existingPayment, orderedBookings);
      const sameBookingIds = haveSameBookingIds(existingBookingIds, targetBookingIds);
      const sameAmount =
        Math.round(Number(existingPayment?.amount || 0)) === Math.round(paymentAmount);
      const sameType = existingPaymentType === normalizedType;

      if (sameBookingIds && sameAmount && sameType) {
        const qr = await QRCodeModel.findOne({ paymentId: existingPayment._id });
        return res.json({
          status: 200,
          data: {
            payment: existingPayment,
            qr,
            amount: paymentAmount,
            type: normalizedType,
            bookingIds: targetBookingIds,
          },
        });
      }

      existingPayment.status = PaymentStatusEnum.FAILED;
      await existingPayment.save();
    }

    const primaryBooking = orderedBookings[0];
    const payment = new PaymentModel({
      bookingId: primaryBooking._id,
      bookingIds: targetBookingIds,
      userId: req.tokenInfo._id,
      amount: paymentAmount,
      method: method,
      paymentType: normalizedType,
      status: PaymentStatusEnum.PENDING,
    });
    await payment.save();

    const descriptionSuffix =
      targetBookingIds.length > 1
        ? `${targetBookingIds.length}-${payment._id.toString().slice(-8)}`
        : payment._id.toString().slice(-8);
    const description = `THANH TOAN ${descriptionSuffix}`.toUpperCase();

    let qrImage = "";
    let qrText = "";
    let payUrl = "";
    let deeplink = "";

    try {
      if (payment.method === PaymentMethodEnum.MOMO) {
        const momoPayment = await createMomoPayment({
          paymentId: payment._id,
          amount: paymentAmount,
          orderInfo: description,
        });
        const rawQrPayload = String(momoPayment.response?.qrCodeUrl || "").trim();

        payment.transactionCode = momoPayment.orderId;
        payment.qrCode = rawQrPayload;
        qrText = rawQrPayload;
        qrImage = buildQrPreviewUrl(rawQrPayload);
        payUrl = String(momoPayment.response?.payUrl || "").trim();
        deeplink = String(momoPayment.response?.deeplink || "").trim();
      } else {
        payment.transactionCode = description;
        const qrUrl = `https://img.vietqr.io/image/${BANK_CONFIG.BANK_ID}-${BANK_CONFIG.ACCOUNT_NO}-compact2.png?amount=${paymentAmount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(BANK_CONFIG.ACCOUNT_NAME)}`;
        qrImage = qrUrl;
      }

      await payment.save();

      const qr = new QRCodeModel({
        paymentId: payment._id,
        qrImage,
        qrText,
        payUrl,
        deeplink,
        expiredAt: new Date(Date.now() + BOOKING_HOLD_DURATION_MS),
      });
      await qr.save();

      return res.json({
        status: 200,
        message: "Khoi tao thanh toan thanh cong",
        data: { payment, qr, amount: paymentAmount, type: normalizedType, bookingIds: targetBookingIds },
      });
    } catch (error) {
      payment.status = PaymentStatusEnum.FAILED;
      try {
        await payment.save();
      } catch (_saveError) {
        // Preserve the original MoMo creation error.
      }
      throw error;
    }
  }

  async confirmPayment(req: Request, res: Response) {
    const { paymentId } = req.body;
    const payment = await PaymentModel.findById(paymentId);
    if (!payment || payment.status === PaymentStatusEnum.PAID) {
      throw ErrorHelper.forbidden("Thanh toan khong hop le hoac da hoan tat");
    }

    const paymentBookingIds = getPaymentBookingIds(payment);
    const bookings = await BookingModel.find({
      _id: { $in: paymentBookingIds },
      isDeleted: false,
    }).sort({ createdAt: 1 });
    const orderedBookings = mapOrderedBookings(bookings, paymentBookingIds);

    if (!orderedBookings.length || orderedBookings.length !== paymentBookingIds.length) {
      throw ErrorHelper.forbidden("Don hang khong ton tai");
    }

    for (const booking of orderedBookings) {
      if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
        throw ErrorHelper.permissionDeny();
      }
    }

    if (
      payment.method !== PaymentMethodEnum.CASH &&
      ![ROLES.ADMIN, ROLES.OWNER].includes(req.tokenInfo.role_)
    ) {
      throw ErrorHelper.forbidden(
        "He thong chua nhan duoc thanh toan. Vui long hoan tat giao dich va thu kiem tra lai sau.",
      );
    }

    const resolvedPaymentType = inferStoredPaymentType(payment, orderedBookings);
    await applySuccessfulPayment(payment, orderedBookings, resolvedPaymentType);

    return res.json({ status: 200, message: "Xac nhan thanh toan thanh cong, san da duoc giu" });
  }

  async checkPaymentStatus(req: Request, res: Response) {
    const normalizedPaymentId = resolveObjectId(req.params.paymentId);
    if (!normalizedPaymentId) {
      throw ErrorHelper.requestDataInvalid("PaymentId khong hop le");
    }

    const payment = await PaymentModel.findById(normalizedPaymentId);
    if (!payment) {
      throw ErrorHelper.forbidden("Khong tim thay payment");
    }

    const paymentBookingIds = getPaymentBookingIds(payment);
    const bookings = await BookingModel.find({
      _id: { $in: paymentBookingIds },
      isDeleted: false,
    }).sort({ createdAt: 1 });
    const orderedBookings = mapOrderedBookings(bookings, paymentBookingIds);

    if (!orderedBookings.length || orderedBookings.length !== paymentBookingIds.length) {
      throw ErrorHelper.forbidden("Don hang khong ton tai");
    }

    for (const booking of orderedBookings) {
      if (!(await canManageBookingPayment(req.tokenInfo, booking))) {
        throw ErrorHelper.permissionDeny();
      }
    }

    if (payment.status === PaymentStatusEnum.PAID) {
      return res.json({
        status: 200,
        message: "Da thanh toan",
        data: { payment },
      });
    }

    if (payment.method !== PaymentMethodEnum.MOMO) {
      return res.json({
        status: 200,
        message: "Payment chua duoc xac nhan.",
        data: { payment },
      });
    }

    const orderId = String(payment.transactionCode || "").trim();
    if (!orderId) {
      throw ErrorHelper.forbidden("Khong tim thay ma giao dich MoMo");
    }

    const momoStatus = await queryMomoPaymentStatus(orderId);

    if (Number(momoStatus?.resultCode) === 0) {
      const resolvedPaymentType = inferStoredPaymentType(payment, orderedBookings);
      await applySuccessfulPayment(payment, orderedBookings, resolvedPaymentType);
      return res.json({
        status: 200,
        message: "MoMo da xac nhan giao dich thanh cong.",
        data: { payment, momoStatus },
      });
    }

    return res.json({
      status: 200,
      message: String(momoStatus?.message || "MoMo chua ghi nhan thanh toan."),
      data: {
        payment,
        momoStatus,
      },
    });
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
    const normalizedBookingId = resolveObjectId(bookingId);

    if (!normalizedBookingId) {
      throw ErrorHelper.requestDataInvalid("BookingId khong hop le");
    }

    const payments = await PaymentModel.find({
      $or: [
        { bookingId: normalizedBookingId },
        { bookingIds: normalizedBookingId },
      ],
      isDeleted: false,
    }).sort({ createdAt: -1 });
    return res.json({ status: 200, data: { payments } });
  }

  async cancelPayment(req: Request, res: Response) {
    const { id } = req.params;
    const payment = await PaymentModel.findById(id);
    if (!payment || payment.status === PaymentStatusEnum.PAID) throw ErrorHelper.forbidden("Khong the huy");
    payment.status = PaymentStatusEnum.FAILED;
    await payment.save();
    return res.json({ status: 200, message: "Da huy yeu cau thanh toan" });
  }

  async getQR(req: Request, res: Response) {
    const { paymentId } = req.params;
    const normalizedPaymentId = resolveObjectId(
      Array.isArray(paymentId) ? paymentId[0] : paymentId,
    );

    if (!normalizedPaymentId) {
      throw ErrorHelper.requestDataInvalid("PaymentId khong hop le");
    }

    const qr = await QRCodeModel.findOne({ paymentId: normalizedPaymentId });
    if (!qr) throw ErrorHelper.forbidden("Khong tim thay QR");
    return res.json({ status: 200, data: qr });
  }
}

export default new PaymentRoute().router;
