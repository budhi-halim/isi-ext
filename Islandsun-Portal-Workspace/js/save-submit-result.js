import { submissionRecord } from './submission-logic.js';

/** State only what the observed save/submission response confirms. */
export function saveSubmitResult({ pending, record, committed, savedVerified, submitted, success }) {
  const known = submissionRecord(record) || submissionRecord({...pending,url:pending.sourceUrl});
  const number = known?.number || pending.number;
  let message;
  if (success) message = 'Submitted.';
  else if (!committed) message = 'Not saved or submitted.';
  else if (savedVerified) message = `Saved as ${pending.kind === 'tir' ? 'Pending' : 'Draft'}; ${submitted ? 'submission could not be confirmed' : 'not submitted'}.`;
  else message = 'The result could not be confirmed. Check the request before trying again.';
  return {message:`${number ? `${number}: ` : ''}${message}`,url:known?.url};
}
