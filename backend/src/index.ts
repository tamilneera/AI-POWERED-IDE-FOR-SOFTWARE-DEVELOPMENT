import express from 'express';
import cors from 'cors';
import db from './db';
import filesRoutes from './filesRoutes';
import workspaceRoutes from './workspaceRoutes';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/workspace', workspaceRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dbConnected: !!db });
});

app.use('/api/files', filesRoutes);

const PORT = 5000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));