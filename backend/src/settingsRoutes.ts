import express from 'express';
import db from './db';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', (req, res) => {
  const { theme, font_size, word_wrap, tab_size, minimap, shortcuts_json } = req.body;
  try {
    db.prepare(
      `UPDATE settings SET
        theme = COALESCE(?, theme),
        font_size = COALESCE(?, font_size),
        word_wrap = COALESCE(?, word_wrap),
        tab_size = COALESCE(?, tab_size),
        minimap = COALESCE(?, minimap),
        shortcuts_json = COALESCE(?, shortcuts_json)
       WHERE id = 1`
    ).run(
      theme ?? null,
      font_size ?? null,
      word_wrap ?? null,
      tab_size ?? null,
      minimap ?? null,
      shortcuts_json ?? null
    );

    const updated = db.prepare('SELECT * FROM settings WHERE id = 1').get();
    res.json({ success: true, settings: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;