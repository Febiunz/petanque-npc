import express from 'express';
import { listSchedule } from '../storage/schedule.js';
import { POOLS } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { round, divisieId, divisie } = req.query;
  const all = await listSchedule({ divisieId: divisieId || POOLS.TOPDIVISIE, divisie });
  const rows = round ? all.filter(m => String(m.round) === String(round)) : all;
  res.json(rows);
});

export default router;
