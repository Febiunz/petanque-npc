import { resultSummary } from './scoring.js';

export const RESULT_EDIT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export function isCompleteDetailedResult(result) {
  return Boolean(resultSummary(result).score);
}

export function getResultEditDeadline(fixtureDate, result) {
  const playDate = Date.parse(fixtureDate || result?.date || '');
  if (!Number.isFinite(playDate)) return null;

  const scheduledDeadline = playDate + RESULT_EDIT_WINDOW_MS;
  const submittedAt = Date.parse(result?.submittedAt || '');
  const lateCompletion = Number.isFinite(submittedAt) && submittedAt >= scheduledDeadline;
  return (lateCompletion ? submittedAt : playDate) + RESULT_EDIT_WINDOW_MS;
}

export function canEditResult(fixtureDate, result, now = Date.now()) {
  if (!result || !isCompleteDetailedResult(result)) return true;
  const deadline = getResultEditDeadline(fixtureDate, result);
  return deadline !== null && now < deadline;
}
