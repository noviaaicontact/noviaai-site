const { finishOAuth, settingsRedirect } = require('../../lib/calendar');

function redirect(location) {
  return {
    statusCode: 302,
    headers: { Location: location, 'Cache-Control': 'no-store' },
    body: '',
  };
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  try {
    const location = await finishOAuth({
      state: q.state,
      code: q.code,
      error: q.error,
      errorDescription: q.error_description,
    });
    return redirect(location);
  } catch (e) {
    console.error('api-calendar-oauth-callback', e.message);
    const reason = /expir/i.test(e.message) ? 'expired' : 'oauth';
    return redirect(settingsRedirect({ calendar: 'error', reason }));
  }
};
