import express from 'express';
import api from './apis';

const router = express.Router();

router.use('/api', api);

export default router;