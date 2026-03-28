import { Terminal } from "./types";

/**
 * Hikvision ISAPI Client for Terminal Management
 * Ported from guard-management-edge (Go)
 */

export class HikvisionClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(private terminal: Terminal) {
    this.baseUrl = `http://${terminal.ip_address}`;
    // Simplified: Using Basic Auth for now. Hikvision often requires Digest.
    // In a real demo, we'd implement a proper Digest provider.
    const credentials = Buffer.from(`${terminal.username}:${terminal.password}`).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  private async request(path: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: this.authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Hikvision ISAPI error: ${response.status} ${response.statusText}`);
    }

    return response;
  }

  async getActivationStatus() {
    const res = await this.request("/SDK/activateStatus");
    const text = await res.text();
    // Simplified parsing
    if (text.includes("activated")) return "activated";
    if (text.includes("not_activated")) return "not_activated";
    return "unknown";
  }

  async registerFace(guardName: string, employeeNo: string, photoUrl: string) {
    // 1. Ensure User Exists
    await this.request("/ISAPI/AccessControl/UserInfo/SetUp?format=json", {
      method: "PUT",
      body: JSON.stringify({
        UserInfo: {
          employeeNo: employeeNo.trim(),
          name: guardName.trim(),
          userType: "normal",
        },
      }),
    });

    // 2. Upload Face Picture
    // Hikvision uses a multipart form for picture upload
    const formData = new FormData();
    formData.append("employeeNo", employeeNo);
    formData.append("name", guardName);
    formData.append("faceURL", photoUrl);
    formData.append("FDID", "1"); // Default face database ID

    await this.request("/ISAPI/Intelligent/FDLib/pictureUpload", {
      method: "POST",
      body: formData,
    });

    return true;
  }

  async deleteFace(employeeNo: string) {
    const xmlBody = `
      <FaceDataRecord>
        <employeeNo>${employeeNo}</employeeNo>
      </FaceDataRecord>
    `;

    await this.request("/ISAPI/Intelligent/FDLib/FaceDataRecord", {
      method: "DELETE",
      body: xmlBody,
      headers: {
        "Content-Type": "application/xml",
      },
    });

    return true;
  }
}
