import express from 'express';
import api from './apis';
import uploadRoute from "../routers/upload/upload.route";
import paymentRoute from "../routers/apis/payment.route"; 


const router = express.Router();

router.use('/api', api);
router.use("/api", uploadRoute);
router.use("/payment", paymentRoute);

export default router;