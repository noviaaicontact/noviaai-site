const { json, corsHeaders } = require('../../lib/http');

function pickMp4(video) {
  const files = (video && video.video_files) || [];
  return files
    .filter((f) => f.file_type === 'video/mp4')
    .sort((a, b) => (b.height || 0) - (a.height || 0))
    .find((f) => (f.height || 0) <= 1080) || files[0];
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'GET') return json(405, { error: 'GET seulement' });

  const key = process.env.PEXELS_API_KEY;
  if (!key) return json(503, { error: 'PEXELS_API_KEY non configurée sur Netlify' });

  const id = (event.queryStringParameters && event.queryStringParameters.id) || '';
  if (!id || !/^\d+$/.test(id)) return json(400, { error: 'id vidéo requis' });

  try {
    const res = await fetch(`https://api.pexels.com/v1/videos/videos/${id}`, {
      headers: { Authorization: key },
    });
    const data = await res.json();
    if (!res.ok) return json(res.status, { error: data.error || 'Pexels error' });

    const file = pickMp4(data);
    const frames = [0, 1, 2, 3, 4].map((n) =>
      `https://images.pexels.com/videos/${id}/pictures/preview-${n}.jpeg`
    );

    return json(200, {
      id: Number(id),
      url: data.url,
      duration: data.duration,
      poster: frames[0],
      frames,
      mp4: file ? file.link : null,
      width: file && file.width,
      height: file && file.height,
    });
  } catch (e) {
    return json(500, { error: e.message || 'Erreur Pexels' });
  }
};
