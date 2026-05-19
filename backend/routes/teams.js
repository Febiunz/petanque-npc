import express from 'express';
import { listTeams, POOLS } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { divisieId, divisie } = req.query;
  const effectiveDivisieId = divisieId || (!divisie ? POOLS.TOPDIVISIE : undefined);
  const teams = await listTeams({ divisieId: effectiveDivisieId, divisie });
  res.json(teams);
});

export default router;
