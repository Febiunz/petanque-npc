import express from 'express';
import { listMatches, POOLS } from '../storage/fileStore.js';
import { submitMatchResult } from '../matchResult.js';
import { requireAuth } from '../middleware/requireAuth.js';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// Use per-user limiting when authenticated, else fall back to IP
const perUserKey = (req) => req.user?.uid || ipKeyGenerator(req.ip);

// Rate limit: max 5 POSTs per minute per user/IP to avoid abuse
const matchPostLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: perUserKey,
  message: 'Too many submissions, please try again later.'
});

// Rate limit: max 100 GETs per minute per IP to avoid abuse of listing endpoint
const matchGetLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

const router = express.Router();

// Basic IP-based pre-auth rate limiter to protect requireAuth from abuse
const authPreLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per minute (adjust as necessary)
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests, please try again later.'
});

router.get('/', matchGetLimiter, async (req, res) => {
  const { divisieId } = req.query;
  const matches = await listMatches({ divisieId: divisieId || POOLS.TOPDIVISIE });
  res.json(matches);
});

// Per-user per-match limiter: prevent spamming the same match result
const perUserPerMatchLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const matchIdRaw = req.body?.matchId || req.body?.fixtureId || 'unknown';
    return `${perUserKey(req)}:${matchIdRaw}`;
  },
  message: 'Too many submissions for this match, please wait a couple of minutes and try again.'
});

// Per-user daily cap to prevent excessive submissions across all matches
const perUserDailyPostLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${perUserKey(req)}:${day}`;
  },
  message: 'Daily submission limit reached, please try again tomorrow.'
});

// Global per-match limiter: throttle submissions for the same match across all users/IPs
const perMatchGlobalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const id = req.body?.matchId || req.body?.fixtureId;
    // If matchId missing, fall back to IP to avoid global lock on "unknown"
    return id ? `match:${id}` : `match:unknown:${ipKeyGenerator(req.ip)}`;
  },
  message: 'Too many submissions for this match, please wait and try again.'
});

router.post(
  '/',
  authPreLimiter,
  requireAuth,
  perUserDailyPostLimiter,
  perUserPerMatchLimiter,
  perMatchGlobalLimiter,
  matchPostLimiter,
  async (req, res) => {
    try {
      const { match, created } = await submitMatchResult(req.body, req.user);
      res.status(created ? 201 : 200).json(match);
    } catch (error) {
      if (!error.status || error.status >= 500) console.error('Could not save match result:', error.message);
      res.status(error.status || 500).json({
        error: error.status && error.status < 500 ? error.message : 'Kon uitslag niet opslaan; probeer opnieuw',
      });
    }
  }
);

export default router;
