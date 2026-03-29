import { BookingModel } from "../models/booking/booking.model";
import { BookingStatusEnum } from "../constants/model.const";

export const autoCancelBooking = async () => {
  const now = new Date();

  await BookingModel.updateMany(
    {
      status: BookingStatusEnum.PENDING,
      expiredAt: { $lt: now },
    },
    {
      status: BookingStatusEnum.CANCELLED,
    }
  );
};