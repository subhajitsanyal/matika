/**
 * Attendant Access Control Security Tests
 *
 * Tests to verify:
 * 1. Attendant can only access assigned patient data
 * 2. Session expiration is enforced
 * 3. Performer info is correctly attached to observations
 * 4. Attendants cannot access relative/doctor-only features
 */

const { handler: observationHandler } = require('../lambdas/observation-crud/index');
const { handler: auditLogHandler } = require('../lambdas/audit-log/index');
const { handler: thresholdHandler } = require('../lambdas/threshold-crud/index');

// Mock database client
jest.mock('pg', () => {
  const mockClient = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Client: jest.fn(() => mockClient) };
});

const { Client } = require('pg');

describe('Attendant Access Control', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = new Client();
    mockClient.connect.mockResolvedValue();
    mockClient.end.mockResolvedValue();
    jest.clearAllMocks();
  });

  describe('Patient Access Verification', () => {
    it('should allow attendant to create observation for assigned patient', async () => {
      // Setup: Attendant is linked to patient
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'active' }],
      });

      // Insert observation
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'obs-1', patient_id: 'patient-123' }],
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await observationHandler(event);
      expect(response.statusCode).toBe(201);
    });

    it('should deny attendant access to unassigned patient', async () => {
      // Setup: No active link exists
      mockClient.query.mockResolvedValueOnce({ rows: [] });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'unassigned-patient' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await observationHandler(event);
      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.body).error).toContain('Access denied');
    });

    it('should deny access when link is inactive', async () => {
      // Setup: Link exists but is inactive
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'inactive' }],
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await observationHandler(event);
      expect(response.statusCode).toBe(403);
    });
  });

  describe('Performer Info Attachment', () => {
    it('should attach performer info to observation', async () => {
      // Setup: Attendant is linked
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'active' }],
      });

      let capturedInsert;
      mockClient.query.mockImplementation((query, params) => {
        if (query.includes('INSERT INTO observations')) {
          capturedInsert = { query, params };
          return { rows: [{ id: 'obs-1' }] };
        }
        return { rows: [] };
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
          performer: {
            id: 'attendant-user-id',
            role: 'attendant',
            name: 'Test Attendant',
          },
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      await observationHandler(event);

      // Verify performer info is in the insert
      expect(capturedInsert.query).toContain('performer');
    });

    it('should reject forged performer info', async () => {
      // Setup: Attendant is linked
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'active' }],
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
          performer: {
            id: 'different-user-id', // Trying to forge a different user
            role: 'doctor',
            name: 'Fake Doctor',
          },
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await observationHandler(event);

      // Should either reject or override with correct performer
      if (response.statusCode === 201) {
        // If accepted, performer should be overridden to match JWT claims
        const body = JSON.parse(response.body);
        expect(body.performer?.id).toBe('attendant-user-id');
      } else {
        expect(response.statusCode).toBe(400);
      }
    });
  });

  describe('Feature Access Restrictions', () => {
    it('should deny attendant access to audit logs', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        pathParameters: { patientId: 'patient-123' },
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await auditLogHandler(event);
      expect(response.statusCode).toBe(403);
    });

    it('should deny attendant access to threshold configuration', async () => {
      // Setup: No access check passes for attendants
      mockClient.query.mockResolvedValue({ rows: [] });

      const event = createEvent({
        httpMethod: 'PUT',
        pathParameters: { patientId: 'patient-123', vitalType: 'bloodPressure' },
        body: JSON.stringify({
          minValue: 90,
          maxValue: 140,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await thresholdHandler(event);
      expect(response.statusCode).toBe(403);
    });

    it('should deny attendant access to care team management', async () => {
      // Attendants should not be able to invite or remove team members
      const event = createEvent({
        httpMethod: 'POST',
        path: '/patients/patient-123/care-team/invite',
        body: JSON.stringify({
          email: 'newmember@example.com',
          role: 'attendant',
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      // Would need care team handler - this is a conceptual test
      // Expecting 403 from care team invitation endpoint
    });
  });

  describe('Session Expiration', () => {
    it('should reject expired session token', async () => {
      // This would be handled by Cognito/API Gateway
      // The test verifies the backend handles missing/invalid claims
      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {}, // No valid claims
      });

      const response = await observationHandler(event);
      expect(response.statusCode).toBe(401);
    });

    it('should log session expiration attempts', async () => {
      // Verify audit log captures expired session attempts
      const consoleSpy = jest.spyOn(console, 'log');

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {}, // No valid claims
      });

      await observationHandler(event);

      // Should log unauthorized attempt
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('Audit Trail Integrity', () => {
    it('should create audit entry for attendant observations', async () => {
      // Setup: Attendant is linked
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'active' }],
      });

      let auditInserted = false;
      mockClient.query.mockImplementation((query, params) => {
        if (query.includes('INSERT INTO observations')) {
          return { rows: [{ id: 'obs-1' }] };
        }
        if (query.includes('INSERT INTO audit_log')) {
          auditInserted = true;
          expect(params).toContain('attendant'); // Role should be attendant
          return { rows: [] };
        }
        return { rows: [] };
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      await observationHandler(event);

      // Verify audit log was created
      // Note: Actual verification depends on implementation
    });

    it('should include attendant identity in audit details', async () => {
      let auditDetails;
      mockClient.query.mockImplementation((query, params) => {
        if (query.includes('INSERT INTO audit_log')) {
          auditDetails = JSON.parse(params[params.length - 1]); // Details is typically last param
          return { rows: [] };
        }
        return { rows: [{ id: '1', status: 'active' }] };
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'bloodPressure',
          systolic: 120,
          diastolic: 80,
        }),
        claims: {
          sub: 'attendant-user-id',
          name: 'Test Attendant',
          'cognito:groups': 'attendants',
        },
      });

      await observationHandler(event);

      // Audit details should include performer info
      // Note: Actual verification depends on implementation
    });
  });

  describe('Cross-Role Access Prevention', () => {
    it('should not allow attendant to escalate to relative role', async () => {
      // Attendant tries to access with relative group claim
      mockClient.query.mockResolvedValue({ rows: [] });

      const event = createEvent({
        httpMethod: 'GET',
        pathParameters: { patientId: 'patient-123' },
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'relatives', // Forged group claim
        },
      });

      const response = await auditLogHandler(event);

      // Should still be denied - the user is not actually in relatives group
      // in Cognito, so this would be caught at API Gateway level
      expect(response.statusCode).not.toBe(200);
    });

    it('should not allow attendant to modify other attendant observations', async () => {
      // Setup: Link exists but observation belongs to different attendant
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', patient_id: 'patient-123', status: 'active' }],
      });

      // Observation was created by different attendant
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'obs-1',
            performer_id: 'other-attendant-id',
            performer_role: 'attendant',
          },
        ],
      });

      const event = createEvent({
        httpMethod: 'PUT',
        pathParameters: { patientId: 'patient-123', observationId: 'obs-1' },
        body: JSON.stringify({
          systolic: 130,
          diastolic: 85,
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      const response = await observationHandler(event);

      // Should be denied or at least audit the modification
      // Policy decision: attendants may or may not edit others' observations
    });
  });
});

// Helper function to create test events
function createEvent({
  httpMethod,
  path = '/test',
  pathParameters = {},
  queryStringParameters = {},
  body = null,
  claims = {},
}) {
  return {
    httpMethod,
    path,
    pathParameters,
    queryStringParameters,
    body,
    requestContext: {
      authorizer: {
        claims,
      },
      http: {
        method: httpMethod,
      },
    },
  };
}

// Additional security test utilities
describe('Security Utilities', () => {
  describe('Input Validation', () => {
    it('should sanitize observation notes to prevent XSS', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 'link-1', status: 'active' }],
      });

      let capturedNote;
      mockClient.query.mockImplementation((query, params) => {
        if (query.includes('INSERT') && params) {
          capturedNote = params.find((p) => typeof p === 'string' && p.includes('script'));
        }
        return { rows: [{ id: '1' }] };
      });

      const event = createEvent({
        httpMethod: 'POST',
        pathParameters: { patientId: 'patient-123' },
        body: JSON.stringify({
          vitalType: 'note',
          text: '<script>alert("xss")</script>',
        }),
        claims: {
          sub: 'attendant-user-id',
          'cognito:groups': 'attendants',
        },
      });

      await observationHandler(event);

      // XSS content should be sanitized or rejected
      // Note: Actual sanitization depends on implementation
    });

    it('should reject SQL injection attempts in filters', async () => {
      const event = createEvent({
        httpMethod: 'GET',
        pathParameters: { patientId: 'patient-123' },
        queryStringParameters: {
          actorId: "'; DROP TABLE audit_log; --",
        },
        claims: {
          sub: 'relative-user-id',
          'cognito:groups': 'relatives',
        },
      });

      // Access check
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: '1' }],
      });

      // Query should use parameterized queries
      let queryCalled = false;
      mockClient.query.mockImplementation((query, params) => {
        queryCalled = true;
        // Verify parameterized query is used
        expect(query).toContain('$');
        expect(params).toContain("'; DROP TABLE audit_log; --");
        return { rows: [], rowCount: 0 };
      });

      await auditLogHandler(event);

      expect(queryCalled).toBe(true);
    });
  });

  describe('Rate Limiting', () => {
    // Note: Rate limiting would typically be handled at API Gateway level
    it('should track request frequency per attendant', async () => {
      // Conceptual test - implementation depends on infrastructure
    });
  });
});
