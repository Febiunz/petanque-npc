import express from 'express';
import { listTeams, POOLS } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { divisieId, divisie } = req.query;
  const teams = await listTeams({ divisieId: divisieId || POOLS.TOPDIVISIE, divisie });
  res.json(teams);
});

export default router;
