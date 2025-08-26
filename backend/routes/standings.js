import express from 'express';
import { computeStandings } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const standings = await computeStandings();
  res.json(standings);
});

export default router;
