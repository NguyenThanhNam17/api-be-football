import express from 'express';
import userRoute from './user.route';
import productRoute from './product.route';

const router = express.Router();

router.use('/user', userRoute);
router.use('/product', productRoute);
export default router;