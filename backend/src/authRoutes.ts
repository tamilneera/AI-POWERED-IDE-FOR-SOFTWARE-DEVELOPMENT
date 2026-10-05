import express from 'express';
import db from './db';

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

router.post('/google', async (req, res) => {
    const { code, redirectUri } = req.body;
    if (!code || !redirectUri) {
        return res.status(400).json({ error: 'code and redirectUri are required' });
    }

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });
        const tokenData: any = await tokenRes.json();

        if (!tokenData.access_token) {
            return res.status(400).json({ error: 'Token exchange failed', details: tokenData });
        }

        const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile: any = await profileRes.json();

        db.prepare(`
      INSERT INTO users (google_id, email, name, picture)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(google_id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture
    `).run(profile.id, profile.email, profile.name, profile.picture);

        res.json({
            success: true,
            user: { id: profile.id, email: profile.email, name: profile.name, picture: profile.picture },
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;