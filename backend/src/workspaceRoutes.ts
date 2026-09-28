import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
}

function buildTree(dirPath: string): TreeNode[] {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  return items
    .filter(item => item.name !== 'node_modules' && item.name !== '.git')
    .map(item => {
      const fullPath = path.join(dirPath, item.name);
      const node: TreeNode = {
        name: item.name,
        path: fullPath,
        isDirectory: item.isDirectory()
      };
      if (item.isDirectory()) {
        try {
          node.children = buildTree(fullPath);
        } catch {
          node.children = [];
        }
      }
      return node;
    });
}

router.get('/tree', (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }
  try {
    const tree = buildTree(targetPath);
    res.json(tree);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Live updates: tells the Explorer whenever something changes inside the opened folder.
// Uses Server-Sent Events, which is what the frontend's EventSource connects to.
router.get('/watch', (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }
  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Folder not found: ' + targetPath });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: connected\n\n');

  let timer: ReturnType<typeof setTimeout> | null = null;
  let watcher: fs.FSWatcher | null = null;

  try {
    watcher = fs.watch(targetPath, { recursive: true }, (_event, filename) => {
      // Ignore noise from folders the Explorer hides anyway
      if (filename && /(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(filename.toString())) return;
      // Wait a moment so a burst of changes sends just one refresh
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => res.write('data: changed\n\n'), 300);
    });
    watcher.on('error', () => {
      watcher?.close();
      res.end();
    });
  } catch {
    res.end();
    return;
  }

  // Keeps the connection from timing out while nothing changes
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (timer) clearTimeout(timer);
    watcher?.close();
  });
});

export default router;