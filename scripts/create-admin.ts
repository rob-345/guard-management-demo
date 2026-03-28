import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || "guard_management_demo";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@westec.co.zw";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Password@123";
const ADMIN_FIRST_NAME = process.env.ADMIN_FIRST_NAME || "System";
const ADMIN_LAST_NAME = process.env.ADMIN_LAST_NAME || "Administrator";

async function createAdmin() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(MONGODB_DATABASE);
    const now = new Date().toISOString();

    const authUsers = db.collection("auth_users");
    const userProfiles = db.collection("user_profiles");

    const normalizedEmail = ADMIN_EMAIL.toLowerCase().trim();
    const existingAuthUser = await authUsers.findOne({ email: normalizedEmail });
    const userId = existingAuthUser?.id ?? uuidv4();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

    if (!existingAuthUser) {
      await authUsers.insertOne({
        _id: userId,
        id: userId,
        email: normalizedEmail,
        password_hash: passwordHash,
        is_active: true,
        created_at: now,
        updated_at: now
      });
    } else {
      await authUsers.updateOne(
        { id: userId },
        { $set: { password_hash: passwordHash, is_active: true, updated_at: now } }
      );
    }

    await userProfiles.updateOne(
      { id: userId },
      {
        $set: {
          first_name: ADMIN_FIRST_NAME,
          last_name: ADMIN_LAST_NAME,
          updated_at: now
        },
        $setOnInsert: {
          _id: userId,
          id: userId,
          created_at: now
        }
      },
      { upsert: true }
    );

    console.log("Admin user and profile created/updated successfully!");
    console.log("\n--- Credentials ---");
    console.log(`Email: ${ADMIN_EMAIL}`);
    console.log(`Password: ${ADMIN_PASSWORD}`);
    console.log("-------------------\n");
  } finally {
    await client.close();
  }
}

createAdmin().catch((error) => {
  console.error("Failed to create admin:", error);
  process.exit(1);
});
