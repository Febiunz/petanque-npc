import express from 'express';
import { ensureSchedule, listSchedule } from '../storage/schedule.js';

const router = express.Router();

router.get('/', async (req, res) => {
  await ensureSchedule();
  const all = await listSchedule();
  const { round } = req.query;
  const rows = round ? all.filter(m => String(m.round) === String(round)) : all;
  res.json(rows);
});

export default router;
