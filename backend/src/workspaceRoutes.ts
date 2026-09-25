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

router.get('/watch', (req, res) => {
  const targetPath = req.query.path as string;
  if (!targetPath) {
    return res.status(400).json({ error: 'path query parameter is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const watcher = fs.watch(targetPath, { recursive: true }, (eventType, filename) => {
    res.write(`data: ${JSON.stringify({ eventType, filename })}\n\n`);
  });

  req.on('close', () => {
    watcher.close();
  });
});

export default router;