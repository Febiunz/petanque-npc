import express from 'express';
import { computeStandings, POOLS } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { divisieId, divisie } = req.query;
  const standings = await computeStandings({ divisieId: divisieId || POOLS.TOPDIVISIE, divisie });
  res.json(standings);
});

export default router;
