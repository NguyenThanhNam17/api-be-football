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

const deriveMomoReturnUrlFromIpnUrl = (ipnUrl: string) => {
  const normalizedIpnUrl = String(ipnUrl || "").trim();
  if (!normalizedIpnUrl) {
    return "";
  }

  return normalizedIpnUrl.replace(/\/ipn\/momo\/?$/i, "/return/momo");
};

const MOMO_CONFIG = {
  apiBaseUrl: String(process.env.MOMO_API_BASE_URL || "https://test-payment.momo.vn").trim().replace(/\/+$/g, ""),
  partnerCode: String(process.env.MOMO_PARTNER_CODE || "").trim(),
  accessKey: String(process.env.MOMO_ACCESS_KEY || "").trim(),
  secretKey: String(process.env.MOMO_SECRET_KEY || "").trim(),
  partnerName: String(process.env.MOMO_PARTNER_NAME || process.env.APP_NAME || "Football Booking").trim(),
  storeId: String(process.env.MOMO_STORE_ID || "FootballBooking").trim(),
  ipnUrl: String(process.env.MOMO_IPN_URL || "https://example.com/momo-ipn").trim(),
  redirectUrl: String(process.env.MOMO_REDIRECT_URL || "https://example.com/momo-return").trim(),
  providerRedirectUrl: String(
    process.env.MOMO_PROVIDER_REDIRECT_URL
    || deriveMomoReturnUrlFromIpnUrl(process.env.MOMO_IPN_URL || "")
    || "https://example.com/momo-return-handler",
  ).trim(),
  lang: String(process.env.MOMO_LANG || "vi").trim() || "vi",
};

const parseBooleanEnv = (value: any) =>
  ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());

const parsePositiveNumberEnv = (value: any, fallback: number) => {
  const normalizedValue = Number(value);
  return Number.isFinite(normalizedValue) && normalizedValue > 0 ? normalizedValue : fallback;
};

const MOMO_MOCK_CONFIG = {
  enabled: parseBooleanEnv(process.env.MOMO_MOCK_MODE),
  autoConfirmMs: parsePositiveNumberEnv(process.env.MOMO_MOCK_AUTO_CONFIRM_SECONDS, 8) * 1000,
};

const MOMO_HTTP_CONFIG = {
  createTimeoutMs: parsePositiveNumberEnv(process.env.MOMO_CREATE_TIMEOUT_MS, 15000),
  queryTimeoutMs: parsePositiveNumberEnv(process.env.MOMO_QUERY_TIMEOUT_MS, 8000),
  retryCount: Math.max(1, parsePositiveNumberEnv(process.env.MOMO_RETRY_COUNT, 2)),
};

const isMomoSandboxEnvironment = MOMO_CONFIG.apiBaseUrl.includes("test-payment.momo.vn");

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

const hasExplicitAmountValue = (value: any) =>
  value !== null &&
  value !== undefined &&
  (typeof value !== "string" || value.trim() !== "");

const calculateOutstandingAmountForBooking = (booking: any) => {
  const totalPrice = Math.max(Number(booking?.totalPrice || 0), 0);
  const depositAmount = Math.max(Number(booking?.depositAmount || 0), 0);
  const rawRemainingAmount = hasExplicitAmountValue(booking?.remainingAmount)
    ? Number(booking?.remainingAmount)
    : Number.NaN;
  const depositStatus = String(booking?.depositStatus || "").trim().toUpperCase();

  if (depositStatus === DepositStatusEnum.PAID) {
    if (Number.isFinite(rawRemainingAmount)) {
      return Math.max(rawRemainingAmount, 0);
    }

    return Math.max(totalPrice - depositAmount, 0);
  }

  return totalPrice;
};

const calculatePaymentAmountForBooking = (booking: any, paymentType: string) => {
  const totalPrice = Number(booking?.totalPrice || 0);
  const depositAmount = Number(booking?.depositAmount || 0);

  if (normalizePaymentType(paymentType) === "FULL") {
    return calculateOutstandingAmountForBooking(booking);
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
  if (MOMO_MOCK_CONFIG.enabled) {
    return;
  }

  if (!MOMO_CONFIG.partnerCode || !MOMO_CONFIG.accessKey || !MOMO_CONFIG.secretKey) {
    throw ErrorHelper.forbidden(
      "Chua cau hinh MoMo sandbox. Vui long them MOMO_PARTNER_CODE, MOMO_ACCESS_KEY va MOMO_SECRET_KEY vao .env backend.",
    );
  }
};

const createHmacSha256 = (data: string, secretKey: string) =>
  crypto.createHmac("sha256", secretKey).update(data).digest("hex");

const postJson = async (
  url: string,
  payload: Record<string, any>,
  {
    timeoutMs = 10000,
    retryCount = 1,
  }: {
    timeoutMs?: number;
    retryCount?: number;
  } = {},
) => {
  let lastError: any = null;

  for (let attempt = 1; attempt <= Math.max(1, retryCount); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const rawData = await response.text();

      if (!response.ok) {
        throw new Error(
          rawData || `MoMo request failed with status ${response.status}`,
        );
      }

      return rawData ? JSON.parse(rawData) : {};
    } catch (error: any) {
      lastError = error;

      if (error?.name === "AbortError") {
        lastError = new Error("MoMo request timeout");
      }

      if (attempt >= Math.max(1, retryCount)) {
        throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError || new Error("MoMo request failed");
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

const pickFirstNonEmptyString = (...values: any[]) => {
  for (const value of values) {
    const normalizedValue = String(value || "").trim();
    if (normalizedValue) {
      return normalizedValue;
    }
  }

  return "";
};

const extractMomoQrArtifacts = (response: any) => {
  const payUrl = pickFirstNonEmptyString(
    response?.payUrl,
    response?.paymentUrl,
  );
  const deeplink = pickFirstNonEmptyString(
    response?.deeplink,
    response?.deepLink,
    response?.deeplinkMiniApp,
    response?.miniAppLink,
  );
  const qrPayload = pickFirstNonEmptyString(
    response?.qrCodeUrl,
    response?.qrCode,
    response?.qrUrl,
    deeplink,
    payUrl,
  );

  return {
    qrPayload,
    payUrl,
    deeplink,
  };
};

const createMockMomoPayment = ({
  paymentId,
  amount,
  orderInfo,
}: {
  paymentId: Types.ObjectId | string;
  amount: number;
  orderInfo: string;
}) => {
  const orderId = `MOMO_MOCK_${String(paymentId || "").trim()}`;
  const autoConfirmAt = new Date(Date.now() + MOMO_MOCK_CONFIG.autoConfirmMs).toISOString();
  const qrPayload = [
    "MOMO-MOCK",
    `orderId=${orderId}`,
    `amount=${amount}`,
    `orderInfo=${orderInfo}`,
    `autoConfirmAt=${autoConfirmAt}`,
  ].join("|");

  return {
    orderId,
    response: {
      resultCode: 0,
      message: "Mock MoMo payment created.",
      qrCodeUrl: qrPayload,
      payUrl: "",
      deeplink: "",
      autoConfirmAt,
    },
  };
};

const verifyMomoIpnSignature = (payload: any) => {
  if (MOMO_MOCK_CONFIG.enabled) {
    return false;
  }

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

  if (MOMO_MOCK_CONFIG.enabled) {
    return createMockMomoPayment({ paymentId, amount, orderInfo });
  }

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
      redirectUrl: MOMO_CONFIG.providerRedirectUrl,
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
    redirectUrl: MOMO_CONFIG.providerRedirectUrl,
    ipnUrl: MOMO_CONFIG.ipnUrl,
    lang: MOMO_CONFIG.lang,
    requestType,
    autoCapture: true,
    extraData,
    signature,
  }, {
    timeoutMs: MOMO_HTTP_CONFIG.createTimeoutMs,
    retryCount: MOMO_HTTP_CONFIG.retryCount,
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

  if (MOMO_MOCK_CONFIG.enabled) {
    return {
      resultCode: 1000,
      message: "Mock MoMo dang cho tu dong xac nhan.",
      orderId,
    };
  }

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
  }, {
    timeoutMs: MOMO_HTTP_CONFIG.queryTimeoutMs,
    retryCount: MOMO_HTTP_CONFIG.retryCount,
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
      const isFullPayment = normalizePaymentType(resolvedPaymentType) === "FULL";
      booking.depositStatus = DepositStatusEnum.PAID;
      booking.depositMethod = mapPaymentMethodToDepositMethod(payment.method as PaymentMethodEnum);
      booking.remainingAmount = isFullPayment
        ? 0
        : Math.max(Number(booking.totalPrice) - paidAmount, 0);
      booking.status = BookingStatusEnum.CONFIRMED;
      booking.expiredAt = undefined;
      await booking.save();
    }),
  );

  return payment;
};

const loadOrderedBookingsForPayment = async (payment: any) => {
  const paymentBookingIds = getPaymentBookingIds(payment);
  const bookings = await BookingModel.find({
    _id: { $in: paymentBookingIds },
    isDeleted: false,
  }).sort({ createdAt: 1 });

  return {
    paymentBookingIds,
    orderedBookings: mapOrderedBookings(bookings, paymentBookingIds),
  };
};

const syncMockMomoPaymentStatus = async (
  payment: any,
  orderedBookings: any[] = [],
) => {
  if (
    !MOMO_MOCK_CONFIG.enabled
    || payment?.method !== PaymentMethodEnum.MOMO
    || payment?.status !== PaymentStatusEnum.PENDING
  ) {
    return payment;
  }

  const createdAt = new Date(payment?.createdAt || Date.now());
  if (
    Number.isNaN(createdAt.getTime())
    || Date.now() - createdAt.getTime() < MOMO_MOCK_CONFIG.autoConfirmMs
  ) {
    return payment;
  }

  const resolvedOrderedBookings = orderedBookings.length
    ? orderedBookings
    : (await loadOrderedBookingsForPayment(payment)).orderedBookings;

  if (!resolvedOrderedBookings.length) {
    return payment;
  }

  const resolvedPaymentType = inferStoredPaymentType(payment, resolvedOrderedBookings);
  return applySuccessfulPayment(payment, resolvedOrderedBookings, resolvedPaymentType);
};

const getMomoPayloadValue = (payload: any, key: string) => {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const directValue = payload[key];
  if (directValue !== undefined && directValue !== null) {
    return String(directValue).trim();
  }

  const lowerKeyEntry = Object.entries(payload).find(
    ([entryKey]) => String(entryKey || "").trim().toLowerCase() === key.toLowerCase(),
  );

  return lowerKeyEntry ? String(lowerKeyEntry[1] ?? "").trim() : "";
};

const isAcceptedMomoProviderPayload = (payload: any) => {
  const partnerCode = getMomoPayloadValue(payload, "partnerCode");
  if (!partnerCode || partnerCode !== MOMO_CONFIG.partnerCode) {
    return false;
  }

  if (verifyMomoIpnSignature(payload)) {
    return true;
  }

  return isMomoSandboxEnvironment;
};

const buildMomoClientRedirectUrl = (payload: any, payment: any = null) => {
  let redirectTarget = String(MOMO_CONFIG.redirectUrl || "").trim();
  const paymentStatus = Number(getMomoPayloadValue(payload, "resultCode")) === 0 ? "success" : "error";
  const paymentMessage = pickFirstNonEmptyString(
    getMomoPayloadValue(payload, "message"),
    paymentStatus === "success"
      ? "Thanh toan thanh cong."
      : "Thanh toan that bai.",
  );

  try {
    const redirectUrl = new URL(redirectTarget);
    if (!redirectUrl.pathname || redirectUrl.pathname === "/") {
      redirectUrl.pathname = "/thanh-toan-cua-toi";
      redirectTarget = redirectUrl.toString();
    }

    const finalizedRedirectUrl = new URL(redirectTarget);
    finalizedRedirectUrl.searchParams.set("paymentStatus", paymentStatus);
    finalizedRedirectUrl.searchParams.set("paymentMessage", paymentMessage);

    const orderId = getMomoPayloadValue(payload, "orderId");
    if (orderId) {
      finalizedRedirectUrl.searchParams.set("orderId", orderId);
    }

    if (payment?._id) {
      finalizedRedirectUrl.searchParams.set("paymentId", String(payment._id));
    }

    const bookingId = String(payment?.bookingId || "").trim();
    if (bookingId) {
      finalizedRedirectUrl.searchParams.set("bookingId", bookingId);
    }

    return finalizedRedirectUrl.toString();
  } catch (_error) {
    return redirectTarget || "/";
  }
};

const syncMomoPaymentFromProviderPayload = async (payload: any) => {
  const orderId = getMomoPayloadValue(payload, "orderId");
  const resultCode = Number(getMomoPayloadValue(payload, "resultCode"));
  const receivedAmount = Number(getMomoPayloadValue(payload, "amount") || 0);

  if (!orderId || !isAcceptedMomoProviderPayload(payload)) {
    return null;
  }

  const payment = await PaymentModel.findOne({
    transactionCode: orderId,
    isDeleted: false,
  });

  if (!payment) {
    return null;
  }

  if (
    Number.isFinite(receivedAmount)
    && receivedAmount > 0
    && Math.round(Number(payment.amount || 0)) !== Math.round(receivedAmount)
  ) {
    return payment;
  }

  if (payment.status === PaymentStatusEnum.PAID) {
    return payment;
  }

  const paymentBookingIds = getPaymentBookingIds(payment);
  const bookings = await BookingModel.find({
    _id: { $in: paymentBookingIds },
    isDeleted: false,
  }).sort({ createdAt: 1 });
  const orderedBookings = mapOrderedBookings(bookings, paymentBookingIds);

  if (!orderedBookings.length || orderedBookings.length !== paymentBookingIds.length) {
    return payment;
  }

  if (resultCode === 0) {
    const resolvedPaymentType = inferStoredPaymentType(payment, orderedBookings);
    return applySuccessfulPayment(payment, orderedBookings, resolvedPaymentType);
  }

  if (resultCode !== 9000 && payment.status === PaymentStatusEnum.PENDING) {
    payment.status = PaymentStatusEnum.FAILED;
    await payment.save();
  }

  return payment;
};

class PaymentRoute extends BaseRoute {
  constructor() {
    super();
  }

  customRouting() {
    this.router.post("/ipn/momo", this.route(this.handleMomoIpn));
    this.router.get("/return/momo", this.route(this.handleMomoReturn));
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
      await syncMomoPaymentFromProviderPayload(req.body || {});
    } catch (error) {
      console.error("MoMo IPN handling failed", error);
    }

    return res.status(204).send();
  }

  async handleMomoReturn(req: Request, res: Response) {
    let payment: any = null;

    try {
      payment = await syncMomoPaymentFromProviderPayload(req.query || {});
    } catch (error) {
      console.error("MoMo return handling failed", error);
    }

    return res.redirect(302, buildMomoClientRedirectUrl(req.query || {}, payment));
  }

  async createPayment(req: Request, res: Response) {
    const { bookingId, bookingIds, method, paymentType } = req.body;
    const targetBookingIds = normalizeRequestedBookingIds(bookingId, bookingIds);
    const normalizedMethod = String(method || "").trim().toUpperCase();

    if (!targetBookingIds.length || !normalizedMethod) {
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
      await syncMockMomoPaymentStatus(existingPayment, orderedBookings);
      if (existingPayment.status !== PaymentStatusEnum.PENDING) {
        continue;
      }

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
      method: normalizedMethod,
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
        const momoQrArtifacts = extractMomoQrArtifacts(momoPayment.response);

        payment.transactionCode = momoPayment.orderId;
        payment.qrCode = momoQrArtifacts.qrPayload;
        qrText = momoQrArtifacts.qrPayload;
        qrImage = buildQrPreviewUrl(momoQrArtifacts.qrPayload);
        payUrl = momoQrArtifacts.payUrl;
        deeplink = momoQrArtifacts.deeplink;

        if (!qrImage) {
          console.error("MoMo QR payload missing", {
            paymentId: String(payment._id || "").trim(),
            orderId: momoPayment.orderId,
            resultCode: momoPayment.response?.resultCode,
            message: momoPayment.response?.message,
            qrCodeUrl: String(momoPayment.response?.qrCodeUrl || "").trim(),
            qrCode: String(momoPayment.response?.qrCode || "").trim(),
            qrUrl: String(momoPayment.response?.qrUrl || "").trim(),
            payUrl,
            deeplink,
            deeplinkMiniApp: String(momoPayment.response?.deeplinkMiniApp || "").trim(),
          });
          throw ErrorHelper.forbidden(
            "MoMo sandbox khong tra ve du lieu QR hop le.",
          );
        }
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

    await syncMockMomoPaymentStatus(payment, orderedBookings);

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

    if (MOMO_MOCK_CONFIG.enabled) {
      return res.json({
        status: 200,
        message: "Mock MoMo chua den thoi diem tu dong xac nhan.",
        data: { payment },
      });
    }

    const orderId = String(payment.transactionCode || "").trim();
    if (!orderId) {
      throw ErrorHelper.forbidden("Khong tim thay ma giao dich MoMo");
    }

    let momoStatus: any = null;

    try {
      momoStatus = await queryMomoPaymentStatus(orderId);
    } catch (error: any) {
      console.error("MoMo status query failed", {
        paymentId: String(payment._id || "").trim(),
        orderId,
        message: String(error?.message || error || "").trim(),
      });

      const refreshedPayment = await PaymentModel.findById(normalizedPaymentId);
      if (refreshedPayment?.status === PaymentStatusEnum.PAID) {
        return res.json({
          status: 200,
          message: "Da thanh toan",
          data: { payment: refreshedPayment },
        });
      }

      return res.json({
        status: 200,
        message: "MoMo dang dong bo giao dich. He thong se tu xac nhan khi nhan callback.",
        data: {
          payment: refreshedPayment || payment,
          momoStatus: {
            resultCode: -1,
            message: String(error?.message || "MoMo request timeout"),
          },
        },
      });
    }

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

    await Promise.all(
      payments.map((payment: any) => syncMockMomoPaymentStatus(payment).catch(() => payment)),
    );

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

    await Promise.all(
      payments.map((payment: any) => syncMockMomoPaymentStatus(payment).catch(() => payment)),
    );

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

