import express from 'express';
import { computeStandings, POOLS } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const { divisieId, divisie } = req.query;
  const filters = { divisie };

  if (divisieId) {
    filters.divisieId = divisieId;
  } else if (!divisie) {
    filters.divisieId = POOLS.TOPDIVISIE;
  }

  const standings = await computeStandings(filters);
  res.json(standings);
});

export default router;
