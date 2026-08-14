const { processDueReviewRequests } = require('../../lib/review-request');
const { processDueFollowups } = require('../../lib/followup');

exports.handler = async () => {
  try {
    const reviews = await processDueReviewRequests();
    const followups = await processDueFollowups();
    const result = { reviews, followups };
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, ...result }),
    };
  } catch (e) {
    console.error('review-queue-processor', e);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message || 'processor failed' }),
    };
  }
};

exports.schedule = '*/1 * * * *';
