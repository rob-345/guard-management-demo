import { MongoClient } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import * as dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const MONGODB_DATABASE = process.env.MONGODB_DATABASE || "guard_management_demo";

async function seed() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();

  try {
    const db = client.db(MONGODB_DATABASE);
    const now = new Date().toISOString();

    // 1. Clear existing data
    await Promise.all([
      db.collection("guards").deleteMany({}),
      db.collection("sites").deleteMany({}),
      db.collection("shifts").deleteMany({}),
      db.collection("site_shift_schedules").deleteMany({}),
      db.collection("guard_assignments").deleteMany({}),
      db.collection("guard_face_enrollments").deleteMany({}),
      db.collection("alerts").deleteMany({}),
      db.collection("terminals").deleteMany({}),
      db.collection("clocking_events").deleteMany({})
    ]);

    // 2. Insert Sites
    const siteData = [
      { id: uuidv4(), name: "Harare Main Office", address: "123 Samora Machel Ave, Harare", region: "Harare Central", contact_person: "Tendai Moyo", contact_phone: "+263 77 300 1000", created_at: now },
      { id: uuidv4(), name: "Bulawayo Depot", address: "45 Fife St, Bulawayo", region: "Bulawayo Metro", contact_person: "Nandi Dube", contact_phone: "+263 77 300 2000", created_at: now }
    ];
    await db.collection("sites").insertMany(siteData.map(s => ({ ...s, _id: s.id } as any)));

    // 3. Insert Site Shift Schedules
    const siteShiftSchedules = [
      {
        id: uuidv4(),
        site_id: siteData[0].id,
        day_shift: {
          start_time: "06:00",
          end_time: "18:00",
          attendance_interval_minutes: 15
        },
        night_shift: {
          start_time: "18:00",
          end_time: "06:00",
          attendance_interval_minutes: 20
        },
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        site_id: siteData[1].id,
        day_shift: {
          start_time: "07:00",
          end_time: "19:00",
          attendance_interval_minutes: 15
        },
        night_shift: null,
        created_at: now,
        updated_at: now
      }
    ];
    await db.collection("site_shift_schedules").insertMany(siteShiftSchedules.map(s => ({ ...s, _id: s.id } as any)));

    // 4. Insert Guards
    const guardData = [
      {
        id: uuidv4(),
        employee_number: "WS-001",
        full_name: "John Muzala",
        phone_number: "+263 77 123 4567",
        photo_url: "https://i.pravatar.cc/150?u=WS-001",
        facial_imprint_synced: true,
        status: "active",
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        employee_number: "WS-002",
        full_name: "Sarah Phiri",
        phone_number: "+263 77 987 6543",
        photo_url: "https://i.pravatar.cc/150?u=WS-002",
        facial_imprint_synced: false,
        status: "active",
        created_at: now,
        updated_at: now
      }
    ];
    await db.collection("guards").insertMany(guardData.map(g => ({ ...g, _id: g.id } as any)));

    // 5. Insert Guard Assignments
    const guardAssignments = [
      {
        id: uuidv4(),
        guard_id: guardData[0].id,
        site_id: siteData[0].id,
        shift_slot: "day",
        effective_date: now,
        status: "active",
        terminal_sync: {
          status: "not_required",
          previous_terminal_count: 0,
          target_terminal_count: 0,
          removed_count: 0,
          removal_failed_count: 0,
          synced_count: 0,
          sync_failed_count: 0,
          updated_at: now
        },
        created_at: now,
        updated_at: now
      },
      {
        id: uuidv4(),
        guard_id: guardData[1].id,
        site_id: siteData[1].id,
        shift_slot: "day",
        effective_date: now,
        status: "active",
        terminal_sync: {
          status: "not_required",
          previous_terminal_count: 0,
          target_terminal_count: 0,
          removed_count: 0,
          removal_failed_count: 0,
          synced_count: 0,
          sync_failed_count: 0,
          updated_at: now
        },
        created_at: now,
        updated_at: now
      }
    ];
    await db.collection("guard_assignments").insertMany(guardAssignments.map(a => ({ ...a, _id: a.id } as any)));

    // 6. Insert Terminals
    const terminalData = [
      {
        id: uuidv4(),
        edge_terminal_id: "TERM-01",
        name: "Main Entrance FR",
        site_id: siteData[0].id,
        ip_address: "192.168.1.50",
        status: "online",
        activation_status: "activated",
        created_at: now
      },
      {
        id: uuidv4(),
        edge_terminal_id: "TERM-02",
        name: "Bulawayo Dispatch Desk",
        site_id: siteData[1].id,
        ip_address: "192.168.1.60",
        status: "online",
        activation_status: "activated",
        created_at: now
      }
    ];
    await db.collection("terminals").insertMany(terminalData.map(t => ({ ...t, _id: t.id } as any)));

    console.log("Seeding complete!");
  } finally {
    await client.close();
  }
}

seed().catch(console.error);
