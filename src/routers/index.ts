import express from 'express';
import api from './apis';
import uploadRoute from "../routers/upload/upload.route";


const router = express.Router();

router.use('/api', api);
router.use("/api", uploadRoute);

export default router;