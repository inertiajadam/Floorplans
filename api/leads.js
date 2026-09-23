/*
 | POST /v1/maps/:slug/leads  (rewritten here by vercel.json)
 |
 | The lead endpoint the embed and the demos post to. For the test
 | deployment it validates the payload and writes it to the function log
 | (Vercel → project → Logs), so a submission can be seen end to end. It
 | does not store or forward anything yet: that is the platform's lead
 | pipeline (task: public embed API), which will replace this file.
 */

export default function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        res.status(405).json({ message: 'Use POST.' });
        return;
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const map = typeof req.query.map === 'string' ? req.query.map : null;
    const name = String(body.name ?? '').trim();
    const contact = String(body.email ?? body.phone ?? '').trim();

    if (!map) {
        res.status(404).json({ message: 'No such map.' });
        return;
    }
    if (!name || !contact) {
        res.status(422).json({ message: 'A name and an email or phone number are needed.' });
        return;
    }

    const id = `lead_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    console.log(JSON.stringify({
        event: 'lead',
        id,
        map,
        name,
        contact,
        unit: body.context?.number ?? body.unit ?? null,
        receivedAt: new Date().toISOString(),
    }));

    res.status(200).json({ ok: true, id });
}
