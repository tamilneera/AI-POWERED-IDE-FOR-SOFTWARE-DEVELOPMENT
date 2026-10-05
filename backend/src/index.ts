import express from 'express';
import cors from 'cors';
import db from './db';
import filesRoutes from './filesRoutes';
import workspaceRoutes from './workspaceRoutes';
import { createServer } from 'http';
import { setupTerminalServer } from './terminal';
import settingsRoutes from './settingsRoutes';
import searchRoutes from './searchRoutes';
import authRoutes from './authRoutes';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/workspace', workspaceRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/auth', authRoutes);


app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', dbConnected: !!db });
});

app.use('/api/files', filesRoutes);


const PORT = 5000;
const server = createServer(app);
setupTerminalServer(server);
server.listen(PORT, () => console.log(`Backend running on port ${PORT}`));