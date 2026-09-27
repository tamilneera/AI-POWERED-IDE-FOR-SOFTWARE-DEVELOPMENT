import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite']);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // skip files over 2MB (likely binary/generated)

function getAllFiles(dir: string, fileList: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return fileList;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      getAllFiles(path.join(dir, entry.name), fileList);
    } else {
      fileList.push(path.join(dir, entry.name));
    }
  }
  return fileList;
}

function buildMatcher(query: string, useRegex: boolean, caseSensitive: boolean): RegExp {
  const flags = caseSensitive ? 'g' : 'gi';
  const pattern = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(pattern, flags);
}

// GET /api/search?path=...&query=...&regex=true&caseSensitive=false
router.get('/', (req, res) => {
  const rootPath = req.query.path as string;
  const query = req.query.query as string;
  const useRegex = req.query.regex === 'true';
  const caseSensitive = req.query.caseSensitive === 'true';

  if (!rootPath || !query) {
    return res.status(400).json({ error: 'path and query are required' });
  }

  let matcher: RegExp;
  try {
    matcher = buildMatcher(query, useRegex, caseSensitive);
  } catch (err: any) {
    return res.status(400).json({ error: 'Invalid regex: ' + err.message });
  }

  try {
    const files = getAllFiles(rootPath);
    const results: { file: string; matches: { line: number; column: number; lineText: string }[] }[] = [];

    for (const file of files) {
      let stat;
      try {
        stat = fs.statSync(file);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_SIZE) continue;

      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // likely binary
      }

      const lines = content.split('\n');
      const fileMatches: { line: number; column: number; lineText: string }[] = [];

      lines.forEach((lineText, idx) => {
        matcher.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = matcher.exec(lineText)) !== null) {
          fileMatches.push({ line: idx + 1, column: m.index + 1, lineText });
          if (m.index === matcher.lastIndex) matcher.lastIndex++;
        }
      });

      if (fileMatches.length > 0) {
        results.push({ file, matches: fileMatches });
      }
    }

    res.json({ results, totalMatches: results.reduce((sum, r) => sum + r.matches.length, 0) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/search/replace
router.post('/replace', (req, res) => {
  const { path: rootPath, query, replacement, regex: useRegex, caseSensitive, files: fileSubset } = req.body;

  if (!rootPath || !query || replacement === undefined) {
    return res.status(400).json({ error: 'path, query, and replacement are required' });
  }

  let matcher: RegExp;
  try {
    matcher = buildMatcher(query, !!useRegex, !!caseSensitive);
  } catch (err: any) {
    return res.status(400).json({ error: 'Invalid regex: ' + err.message });
  }

  try {
    const files = fileSubset && fileSubset.length > 0 ? fileSubset : getAllFiles(rootPath);
    let filesChanged = 0;
    let replacements = 0;

    for (const file of files) {
      let content: string;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue;
      }

      matcher.lastIndex = 0;
      const matchCount = (content.match(matcher) || []).length;
      if (matchCount === 0) continue;

      const newContent = content.replace(matcher, replacement);
      fs.writeFileSync(file, newContent, 'utf-8');
      filesChanged++;
      replacements += matchCount;
    }

    res.json({ success: true, filesChanged, replacements });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;