import { MongoClient, Db, GridFSBucket } from "mongodb";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";

const uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const dbName = process.env.MONGODB_DATABASE || "guard_management_demo";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;
let isBootstrapped = false;

async function bootstrapAdmin(db: Db) {
  if (isBootstrapped) return;
  
  const authUsers = db.collection("auth_users");
  const userProfiles = db.collection("user_profiles");
  
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@westec.co.zw").toLowerCase().trim();
  const existing = await authUsers.findOne({ email: adminEmail });
  
  if (!existing) {
    console.log(`Bootstrapping admin user: ${adminEmail}`);
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD || "Password@123", 10);
    const now = new Date().toISOString();
    
    await authUsers.insertOne({
      _id: userId,
      id: userId,
      email: adminEmail,
      password_hash: passwordHash,
      is_active: true,
      created_at: now,
      updated_at: now
    } as any);
    
    await userProfiles.insertOne({
      _id: userId,
      id: userId,
      first_name: process.env.ADMIN_FIRST_NAME || "System",
      last_name: process.env.ADMIN_LAST_NAME || "Administrator",
      created_at: now,
      updated_at: now
    } as any);
  }
  
  isBootstrapped = true;
}

export async function connectToDatabase() {
  if (cachedClient && cachedDb) {
    return { client: cachedClient, db: cachedDb };
  }

  const client = await MongoClient.connect(uri);
  const db = client.db(dbName);

  await bootstrapAdmin(db);

  cachedClient = client;
  cachedDb = db;

  return { client, db };
}

export async function getCollection<T = any>(name: string) {
  const { db } = await connectToDatabase();
  return db.collection<T | any>(name);
}

export async function getGridFSBucket(bucketName = process.env.GRIDFS_BUCKET_NAME || "guard_photos") {
  const { db } = await connectToDatabase();
  return new GridFSBucket(db, { bucketName });
}
