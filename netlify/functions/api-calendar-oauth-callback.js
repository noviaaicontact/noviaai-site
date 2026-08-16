const { finishOAuth, settingsRedirect, oauthCookieHeader } = require('../../lib/calendar');

function redirect(location, extraHeaders = {}) {
  return {
    statusCode: 302,
    headers: {
      Location: location,
      'Cache-Control': 'no-store',
      'Set-Cookie': oauthCookieHeader('', { clear: true }),
      ...extraHeaders,
    },
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
      event,
    });
    return redirect(location);
  } catch (e) {
    console.error('api-calendar-oauth-callback', e.message);
    const reason = e && e.code && String(e.code).startsWith('oauth_')
      ? 'session'
      : /expir/i.test(e.message) ? 'expired' : 'oauth';
    return redirect(settingsRedirect({ calendar: 'error', reason }));
  }
};
