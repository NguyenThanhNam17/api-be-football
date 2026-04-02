import {
  BookingStatusEnum,
  DepositStatusEnum,
  PaymentStatusEnum,
} from "../constants/model.const";
import { BookingModel, IBooking } from "../models/booking/booking.model";
import { PaymentModel } from "../models/Payment/payment.model";

export const BOOKING_HOLD_MINUTES = 5;
export const BOOKING_HOLD_DURATION_MS = BOOKING_HOLD_MINUTES * 60 * 1000;

const getBookingCreatedAt = (booking: Partial<IBooking> & { createdAt?: Date | string | null }) => {
  const createdAt = booking?.createdAt ? new Date(booking.createdAt) : new Date();
  return Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
};

export const getBookingHoldExpiresAt = (
  booking: Partial<IBooking> & { createdAt?: Date | string | null },
) => new Date(getBookingCreatedAt(booking).getTime() + BOOKING_HOLD_DURATION_MS);

export const isPendingHoldBooking = (booking: Partial<IBooking> | null | undefined) =>
  String(booking?.status || "").trim().toUpperCase() === BookingStatusEnum.PENDING &&
  String(booking?.depositStatus || "").trim().toUpperCase() !== DepositStatusEnum.PAID;

export const isBookingHoldExpired = (
  booking: Partial<IBooking> & { createdAt?: Date | string | null },
  now: Date = new Date(),
) => isPendingHoldBooking(booking) && getBookingHoldExpiresAt(booking).getTime() <= now.getTime();

export const canReuseBookingSlot = (
  booking: Partial<IBooking> & { createdAt?: Date | string | null },
  now: Date = new Date(),
) => {
  const status = String(booking?.status || "").trim().toUpperCase();
  const depositStatus = String(booking?.depositStatus || "").trim().toUpperCase();

  if (depositStatus === DepositStatusEnum.PAID) {
    return false;
  }

  if (status === BookingStatusEnum.CANCELLED) {
    return true;
  }

  return isBookingHoldExpired(booking, now);
};

export const isBookingBlocking = (
  booking: Partial<IBooking> & { createdAt?: Date | string | null },
  now: Date = new Date(),
) => {
  const status = String(booking?.status || "").trim().toUpperCase();
  const depositStatus = String(booking?.depositStatus || "").trim().toUpperCase();

  if (status === BookingStatusEnum.CANCELLED) {
    return false;
  }

  if (depositStatus === DepositStatusEnum.PAID) {
    return true;
  }

  if (status === BookingStatusEnum.CONFIRMED || status === BookingStatusEnum.COMPLETED) {
    return true;
  }

  if (status === BookingStatusEnum.PENDING) {
    return !isBookingHoldExpired(booking, now);
  }

  return false;
};

export const expireStalePendingBookings = async (
  filter: any = {},
  now: Date = new Date(),
) => {
  const expireBefore = new Date(now.getTime() - BOOKING_HOLD_DURATION_MS);
  const staleBookings = await BookingModel.find({
    ...filter,
    isDeleted: false,
    status: BookingStatusEnum.PENDING,
    depositStatus: { $ne: DepositStatusEnum.PAID },
    createdAt: { $lte: expireBefore },
  });

  if (!staleBookings.length) {
    return [];
  }

  const staleIds = staleBookings.map((booking) => booking._id);

  await BookingModel.updateMany(
    { _id: { $in: staleIds } },
    { $set: { status: BookingStatusEnum.CANCELLED } },
  );

  await PaymentModel.updateMany(
    {
      bookingId: { $in: staleIds },
      isDeleted: false,
      status: PaymentStatusEnum.PENDING,
    },
    { $set: { status: PaymentStatusEnum.FAILED } },
  );

  return staleIds;
};

export const buildActiveBookingFilter = (
  filter: any = {},
  now: Date = new Date(),
): any => {
  const expireBefore = new Date(now.getTime() - BOOKING_HOLD_DURATION_MS);

  return {
    ...filter,
    isDeleted: false,
    $or: [
      {
        status: {
          $in: [BookingStatusEnum.CONFIRMED, BookingStatusEnum.COMPLETED],
        },
      },
      {
        status: BookingStatusEnum.PENDING,
        depositStatus: { $ne: DepositStatusEnum.PAID },
        createdAt: { $gt: expireBefore },
      },
    ],
  };
};
