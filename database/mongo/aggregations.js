import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
const uri = process.env.MONGO_URI;
const dbName = process.env.MONGO_DB;
if (!uri || !dbName) throw new Error('MONGO_URI and MONGO_DB must be set in the repository .env file.');

export const topKeywordsByCategory = [
  { $unwind: '$extracted.keywords' },
  { $group: { _id: { category: '$category', keyword: '$extracted.keywords' }, count: { $sum: 1 } } },
  { $sort: { count: -1, '_id.category': 1, '_id.keyword': 1 } },
  { $limit: 20 }
];

export const categoryStats = [
  {
    $group: {
      _id: '$category',
      documents: { $sum: 1 },
      totalPages: { $sum: { $ifNull: ['$pageCount', 0] } },
      totalWords: { $sum: { $ifNull: ['$extracted.wordCount', 0] } },
      averageWords: { $avg: { $ifNull: ['$extracted.wordCount', 0] } }
    }
  },
  { $sort: { documents: -1, _id: 1 } }
];

export const longestDocuments = [
  { $project: { fileName: 1, category: 1, pageCount: 1, wordCount: '$extracted.wordCount' } },
  { $sort: { wordCount: -1, pageCount: -1, fileName: 1 } },
  { $limit: 10 }
];

export const dashboardFacet = [
  {
    $facet: {
      categories: categoryStats,
      longestDocuments,
      topKeywords: topKeywordsByCategory
    }
  }
];

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const collection = client.db(dbName).collection('document_contents');
    const [results] = await collection.aggregate(dashboardFacet).toArray();
    console.log(JSON.stringify(results ?? { categories: [], longestDocuments: [], topKeywords: [] }, null, 2));
  } finally {
    await client.close();
  }
}
