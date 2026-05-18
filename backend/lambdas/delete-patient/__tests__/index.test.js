/**
 * Tests for delete-patient Lambda (Stream B hardened cascade).
 *
 * Covers the three high-blast-radius behaviors added in 2026-05-17:
 *   1. Happy path — full cascade (DB rows, device_tokens, S3 prefix, secondary
 *      caregivers' Cognito attribute).
 *   2. S3 failure tolerance — txn already committed; failure logged, 200 still
 *      returned to the caller.
 *   3. Auth — non-primary-caregiver caller gets 403, no txn started.
 */

const mockSmSend = jest.fn();
const mockCognitoSend = jest.fn();
const mockS3Send = jest.fn();
const mockSesSend = jest.fn();

const mockConnect = jest.fn();
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock("pg", () => ({
  Client: jest.fn(),
}));

jest.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: jest.fn().mockImplementation(() => ({
    send: mockSmSend,
  })),
  GetSecretValueCommand: jest.fn((arg) => ({ __cmd: "GetSecret", ...arg })),
}));

jest.mock("@aws-sdk/client-cognito-identity-provider", () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: mockCognitoSend,
  })),
  AdminDisableUserCommand: jest.fn((arg) => ({ __cmd: "AdminDisableUser", ...arg })),
  AdminUpdateUserAttributesCommand: jest.fn((arg) => ({
    __cmd: "AdminUpdateUserAttributes",
    ...arg,
  })),
}));

jest.mock("@aws-sdk/client-s3", () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: mockS3Send,
  })),
  ListObjectsV2Command: jest.fn((arg) => ({ __cmd: "ListObjectsV2", ...arg })),
  DeleteObjectsCommand: jest.fn((arg) => ({ __cmd: "DeleteObjects", ...arg })),
}));

jest.mock("@aws-sdk/client-ses", () => ({
  SESClient: jest.fn().mockImplementation(() => ({
    send: mockSesSend,
  })),
  SendEmailCommand: jest.fn((arg) => ({ __cmd: "SendEmail", ...arg })),
}));

process.env.DB_SECRET_NAME = "test-secret";
process.env.COGNITO_USER_POOL_ID = "ap-south-1_TEST";
process.env.DOCUMENTS_BUCKET = "carelog-test-documents";
process.env.FROM_EMAIL = "noreply-test@carelog.in";

const { Client } = require("pg");
const { handler } = require("../index");

const PRIMARY_CAREGIVER_SUB = "cog-sub-primary-cg";
const SECONDARY_CAREGIVER_SUB = "cog-sub-secondary-cg";
const PATIENT_DB_UUID = "patient-uuid-1";
const PATIENT_USER_UUID = "patient-user-uuid-1";
const PATIENT_SHORT_CODE = "CL-TEST01";
const PATIENT_NAME = "Ramesh Sharma";
const PATIENT_EMAIL = "patient@carelog.test";
const PATIENT_COGNITO_SUB = "cog-sub-patient";
const ATTENDANT_USER_UUID = "att-user-uuid-1";

const dbCreds = {
  host: "localhost",
  port: 5432,
  dbname: "testdb",
  username: "u",
  password: "p",
};

function buildEvent(short = PATIENT_SHORT_CODE) {
  return {
    pathParameters: { patientId: short },
    requestContext: {
      authorizer: { claims: { sub: PRIMARY_CAREGIVER_SUB } },
    },
  };
}

function installHappyPathQueryStub() {
  mockQuery.mockImplementation((sql, params) => {
    const s = sql.replace(/\s+/g, " ").trim();

    if (s.startsWith("SELECT p.id as patient_db_id")) {
      return Promise.resolve({
        rows: [
          {
            patient_db_id: PATIENT_DB_UUID,
            patient_id: PATIENT_SHORT_CODE,
            patient_name: PATIENT_NAME,
          },
        ],
      });
    }
    if (s.startsWith("BEGIN")) return Promise.resolve();
    if (s.startsWith("COMMIT")) return Promise.resolve();
    if (s.startsWith("ROLLBACK")) return Promise.resolve();

    if (s.startsWith("SELECT u.id as user_id, u.cognito_sub")) {
      return Promise.resolve({
        rows: [
          {
            user_id: PATIENT_USER_UUID,
            cognito_sub: PATIENT_COGNITO_SUB,
            email: PATIENT_EMAIL,
          },
        ],
      });
    }
    if (s.includes("FROM persona_links pl") && s.includes("'attendant', 'doctor'")) {
      return Promise.resolve({
        rows: [
          {
            id: ATTENDANT_USER_UUID,
            email: "attendant@test.com",
            name: "Attendant One",
            cognito_sub: "cog-sub-att",
            relationship: "attendant",
          },
        ],
      });
    }
    if (s.includes("FROM persona_links pl") && s.includes("relationship = 'caregiver'")) {
      return Promise.resolve({
        rows: [{ cognito_sub: SECONDARY_CAREGIVER_SUB }],
      });
    }
    if (s.startsWith("UPDATE users SET is_active = false")) {
      return Promise.resolve({ rowCount: 1 });
    }
    if (s.startsWith("UPDATE persona_links")) return Promise.resolve({ rowCount: 2 });
    if (s.startsWith("UPDATE attendant_invites")) return Promise.resolve({ rowCount: 0 });
    if (s.startsWith("UPDATE doctor_invites")) return Promise.resolve({ rowCount: 0 });
    if (s.startsWith("DELETE FROM device_tokens")) return Promise.resolve({ rowCount: 3 });
    if (s.startsWith("DELETE FROM deletion_requests")) return Promise.resolve({ rowCount: 0 });
    if (s.startsWith("DELETE FROM patients")) return Promise.resolve({ rowCount: 1 });
    if (s.startsWith("INSERT INTO audit_log")) return Promise.resolve({ rowCount: 1 });

    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Client.mockImplementation(() => ({
    connect: mockConnect,
    query: mockQuery,
    end: mockEnd,
  }));
  mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(dbCreds) });
  mockCognitoSend.mockResolvedValue({});
  mockSesSend.mockResolvedValue({});
  mockS3Send.mockResolvedValue({});
});

describe("delete-patient Lambda — cascade", () => {
  test("happy path: full cascade across DB, S3, Cognito", async () => {
    installHappyPathQueryStub();
    mockS3Send.mockImplementation((cmd) => {
      if (cmd.__cmd === "ListObjectsV2") {
        return Promise.resolve({
          Contents: [
            { Key: `observations/${PATIENT_SHORT_CODE}/2026/05/01/a.json` },
            { Key: `observations/${PATIENT_SHORT_CODE}/2026/05/02/b.json` },
          ],
          IsTruncated: false,
        });
      }
      if (cmd.__cmd === "DeleteObjects") return Promise.resolve({});
      return Promise.resolve({});
    });

    const result = await handler(buildEvent());

    expect(result.statusCode).toBe(200);

    // Transaction wrapped the SQL
    const sqlOrder = mockQuery.mock.calls.map((c) => c[0].replace(/\s+/g, " ").trim());
    expect(sqlOrder.some((s) => s.startsWith("BEGIN"))).toBe(true);
    expect(sqlOrder.some((s) => s.startsWith("COMMIT"))).toBe(true);
    expect(sqlOrder.some((s) => s.startsWith("ROLLBACK"))).toBe(false);

    // device_tokens hard-delete happened BEFORE patients delete
    const tokenIdx = sqlOrder.findIndex((s) => s.startsWith("DELETE FROM device_tokens"));
    const patientIdx = sqlOrder.findIndex((s) => s.startsWith("DELETE FROM patients"));
    expect(tokenIdx).toBeGreaterThan(-1);
    expect(patientIdx).toBeGreaterThan(tokenIdx);

    // deletion_requests defensive delete also before patients
    const drIdx = sqlOrder.findIndex((s) => s.startsWith("DELETE FROM deletion_requests"));
    expect(drIdx).toBeGreaterThan(-1);
    expect(patientIdx).toBeGreaterThan(drIdx);

    // Audit log row inserted with the new counts
    const auditCall = mockQuery.mock.calls.find((c) =>
      c[0].includes("INSERT INTO audit_log")
    );
    expect(auditCall).toBeDefined();
    const auditDetails = JSON.parse(auditCall[1][2]);
    expect(auditDetails.removedDeviceTokens).toBe(3);
    expect(auditDetails.removedDeletionRequests).toBe(0);
    expect(auditDetails.secondaryCaregiverCount).toBe(1);

    // Cognito disables: 1 attendant + 1 patient = 2; attribute clears:
    // 1 deleting caregiver (inside txn) + 1 secondary (post-commit) = 2.
    const cognitoCmds = mockCognitoSend.mock.calls.map((c) => c[0].__cmd);
    expect(cognitoCmds.filter((c) => c === "AdminDisableUser").length).toBe(2);
    expect(
      cognitoCmds.filter((c) => c === "AdminUpdateUserAttributes").length
    ).toBe(2);

    // S3 list+delete fired with the short-code prefix
    const s3Cmds = mockS3Send.mock.calls.map((c) => c[0]);
    const listCall = s3Cmds.find((c) => c.__cmd === "ListObjectsV2");
    expect(listCall.Prefix).toBe(`observations/${PATIENT_SHORT_CODE}/`);
    const deleteCall = s3Cmds.find((c) => c.__cmd === "DeleteObjects");
    expect(deleteCall.Delete.Objects).toHaveLength(2);
  });

  test("S3 failure does not roll back the committed DB transaction", async () => {
    installHappyPathQueryStub();
    mockS3Send.mockImplementation((cmd) => {
      if (cmd.__cmd === "ListObjectsV2") {
        return Promise.reject(new Error("AccessDenied"));
      }
      return Promise.resolve({});
    });

    const result = await handler(buildEvent());

    expect(result.statusCode).toBe(200);
    const sqlOrder = mockQuery.mock.calls.map((c) => c[0].replace(/\s+/g, " ").trim());
    expect(sqlOrder.some((s) => s.startsWith("COMMIT"))).toBe(true);
    expect(sqlOrder.some((s) => s.startsWith("ROLLBACK"))).toBe(false);
  });

  test("non-primary caregiver gets 403; no transaction begins", async () => {
    mockQuery.mockImplementation((sql) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT p.id as patient_db_id")) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await handler(buildEvent());

    expect(result.statusCode).toBe(403);
    const sqlOrder = mockQuery.mock.calls.map((c) => c[0].replace(/\s+/g, " ").trim());
    expect(sqlOrder.some((s) => s.startsWith("BEGIN"))).toBe(false);
    expect(sqlOrder.some((s) => s.startsWith("DELETE"))).toBe(false);
    // No Cognito or S3 traffic on auth failure
    expect(mockCognitoSend).not.toHaveBeenCalled();
    expect(mockS3Send).not.toHaveBeenCalled();
  });
});
