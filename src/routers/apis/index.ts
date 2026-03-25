import express from 'express';
import userRoute from './user.route';
import fieldRoute from './field.route';
import subFieldRoute from './subField.route';
import timeSlotRoute from './timeSlot.route';
import bookingRoute from './booking.route';

const router = express.Router();

router.use('/user', userRoute);
router.use('/field', fieldRoute);
router.use('/subField', subFieldRoute);
router.use('/timeSlot', timeSlotRoute);
router.use('/booking', bookingRoute);
export default router;