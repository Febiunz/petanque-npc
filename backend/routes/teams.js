import express from 'express';
import { listTeams } from '../storage/fileStore.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const teams = await listTeams();
  res.json(teams);
});

export default router;
