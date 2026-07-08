const { processDueReviewRequests } = require('../../lib/review-request');

exports.handler = async () => {
  try {
    const result = await processDueReviewRequests();
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
