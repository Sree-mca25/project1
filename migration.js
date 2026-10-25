
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const db = require('./database');

const backupPath = [
  path.join(__dirname, 'sathish-media-backup(1).json'),
  path.join(__dirname, 'sathish-media-backup.json')
].find((file) => fs.existsSync(file));

if (!backupPath) {
  console.error(
    'Backup file not found! Place sathish-media-backup(1).json beside migration.js.'
  );
  process.exit(1);
}

function parseItems(value, tableName) {
  try {
    const items = typeof value === 'string' ? JSON.parse(value) : value;

    if (!Array.isArray(items)) {
      throw new Error(`${tableName} data must be an array.`);
    }

    return items;
  } catch (error) {
    throw new Error(`Cannot read ${tableName} backup: ${error.message}`);
  }
}

function tableExists(tableName) {
  return Boolean(
    db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(tableName)
  );
}

function getTableCount(tableName) {
  return db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get().count;
}

function getName(item, tableName) {
  if (tableName === 'portfolio') {
    return item.name || item.title || 'Untitled Portfolio';
  }

  if (tableName === 'services') {
    return item.name || item.title || item.serviceName || 'Untitled Service';
  }

  return item.name || item.title || `Untitled ${tableName}`;
}

function migrate() {
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  const tables = [
    'products',
    'services',
    'portfolio',
    'arts',
    'courses'
  ];

  const data = {};

  for (const table of tables) {
    if (!tableExists(table)) {
      throw new Error(
        `Table "${table}" does not exist. Check database.js first.`
      );
    }

    data[table] = parseItems(backup[table] ?? [], table);
  }

  const transaction = db.transaction(() => {
    for (const table of tables) {
      const items = data[table];

      if (getTableCount(table) > 0) {
        console.log(
          `SKIPPED ${table}: table already contains data.`
        );
        continue;
      }

      for (const item of items) {
        if (table === 'products') {
          db.prepare(`
            INSERT INTO products (
              product_code,
              name,
              category,
              subcategory,
              price,
              image,
              description,
              stock,
              status,
              data_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            String(item.product_code || item.uniqueId || item.id || ''),
            String(item.name || 'Untitled Product'),
            String(item.category || ''),
            String(item.subcategory || item.subCategory || ''),
            Number(item.price) || 0,
            String(item.image || ''),
            String(item.description || ''),
            Number(item.stock) || 0,
            String(item.status || 'Active'),
            JSON.stringify(item)
          );
        } else {
          db.prepare(`
            INSERT INTO "${table}" (name, data_json)
            VALUES (?, ?)
          `).run(
            String(getName(item, table)),
            JSON.stringify(item)
          );
        }
      }

      console.log(`IMPORTED ${items.length} ${table}.`);
    }
  });

  transaction();

  console.log('\nMigration completed!');
  console.log('\nDatabase totals:');

  for (const table of tables) {
    console.log(`${table}: ${getTableCount(table)}`);
  }
}

try {
  migrate();
} catch (error) {
  console.error('\nMigration failed:', error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
