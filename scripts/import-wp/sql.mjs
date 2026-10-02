import fs from 'node:fs';

const ESCAPES = { n: '\n', r: '\r', t: '\t', 0: '\0', Z: '\x1a', b: '\b' };

/**
 * Parses phpMyAdmin/mysqldump INSERT statements into row objects keyed by column name.
 * Returns a Map of table name -> array of row objects.
 */
export function parseDump(file, tables) {
  const sql = fs.readFileSync(file, 'utf8');
  const wanted = new Set(tables);
  const result = new Map(tables.map((t) => [t, []]));
  const insertRe = /INSERT INTO `([^`]+)` \(([^)]*)\) VALUES\s*/g;
  let m;
  while ((m = insertRe.exec(sql))) {
    const table = m[1];
    const columns = m[2].split(',').map((c) => c.trim().replace(/`/g, ''));
    let i = insertRe.lastIndex;
    const rows = [];
    // Walk tuples until the terminating semicolon outside of quotes.
    while (i < sql.length) {
      const ch = sql[i];
      if (ch === ';') break;
      if (ch !== '(') { i++; continue; }
      i++;
      const values = [];
      let cur = '';
      let quoted = false;
      let wasQuoted = false;
      while (i < sql.length) {
        const c = sql[i];
        if (quoted) {
          if (c === '\\') {
            const next = sql[i + 1];
            cur += ESCAPES[next] ?? next;
            i += 2;
            continue;
          }
          if (c === "'") {
            if (sql[i + 1] === "'") { cur += "'"; i += 2; continue; }
            quoted = false; i++; continue;
          }
          cur += c; i++; continue;
        }
        if (c === "'") { quoted = true; wasQuoted = true; cur = ''; i++; continue; }
        if (c === ',' || c === ')') {
          const raw = wasQuoted ? cur : cur.trim();
          values.push(!wasQuoted && raw === 'NULL' ? null : raw);
          cur = ''; wasQuoted = false; i++;
          if (c === ')') break;
          continue;
        }
        cur += c; i++;
      }
      if (wanted.has(table)) {
        const row = {};
        columns.forEach((col, idx) => { row[col] = values[idx]; });
        rows.push(row);
      }
    }
    insertRe.lastIndex = i;
    if (wanted.has(table)) result.get(table).push(...rows);
  }
  return result;
}
