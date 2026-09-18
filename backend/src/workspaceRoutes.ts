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

export default router;