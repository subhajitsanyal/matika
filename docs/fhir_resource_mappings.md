# CareLog FHIR R4 Resource Mappings

**Version:** 1.0
**Date:** March 2026
**FHIR Version:** R4 (4.0.1)

---

## Overview

This document defines the mapping between CareLog application data and FHIR R4 resources. All health data in CareLog is stored as FHIR resources in AWS HealthLake for interoperability, compliance, and future-proofing.

## Table of Contents

1. [Patient Resource](#1-patient-resource)
2. [Observation Resources](#2-observation-resources)
3. [DocumentReference Resource](#3-documentreference-resource)
4. [CarePlan Resource](#4-careplan-resource)
5. [LOINC Code Reference](#5-loinc-code-reference)

---

## 1. Patient Resource

Maps CareLog patient profile to FHIR Patient resource.

### Field Mapping

| CareLog Field | FHIR Path | Notes |
|---------------|-----------|-------|
| patientId | identifier[0].value | System: https://carelog.com/patient-id |
| name | name[0].text | Official use |
| dateOfBirth | birthDate | ISO 8601 date |
| gender | gender | male / female / other / unknown |
| bloodType | extension[0].valueString | Custom extension |
| emergencyContactName | contact[0].name.text | Relationship: C (Emergency Contact) |
| emergencyContactPhone | contact[0].telecom[0].value | System: phone |

### JSON Schema Example

```json
{
  "resourceType": "Patient",
  "id": "patient-cl-abc123",
  "meta": {
    "versionId": "1",
    "lastUpdated": "2026-03-14T10:30:00Z",
    "profile": ["https://carelog.com/fhir/StructureDefinition/CareLogPatient"]
  },
  "identifier": [
    {
      "system": "https://carelog.com/patient-id",
      "value": "CL-ABC123"
    }
  ],
  "active": true,
  "name": [
    {
      "use": "official",
      "text": "John Doe"
    }
  ],
  "gender": "male",
  "birthDate": "1945-06-15",
  "extension": [
    {
      "url": "https://carelog.com/fhir/StructureDefinition/blood-type",
      "valueString": "O+"
    }
  ],
  "contact": [
    {
      "relationship": [
        {
          "coding": [
            {
              "system": "http://terminology.hl7.org/CodeSystem/v2-0131",
              "code": "C",
              "display": "Emergency Contact"
            }
          ]
        }
      ],
      "name": {
        "text": "Jane Doe"
      },
      "telecom": [
        {
          "system": "phone",
          "value": "+91-9876543210",
          "use": "mobile"
        }
      ]
    }
  ]
}
```

---

## 2. Observation Resources

Maps CareLog vital signs to FHIR Observation resources. Each vital type uses specific LOINC codes.

### 2.1 Body Weight

| CareLog Field | FHIR Path | Notes |
|---------------|-----------|-------|
| value | valueQuantity.value | Numeric value |
| unit | valueQuantity.unit | "kg" or "lb" |
| timestamp | effectiveDateTime | ISO 8601 datetime |
| patientId | subject.reference | Patient/CL-XXXXXX |
| recordedBy | performer[0].reference | Practitioner or RelatedPerson |
| notes | note[0].text | Optional observation notes |

**LOINC Code:** 29463-7 (Body weight)

```json
{
  "resourceType": "Observation",
  "id": "obs-weight-12345",
  "meta": {
    "lastUpdated": "2026-03-14T08:00:00Z"
  },
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "29463-7",
        "display": "Body weight"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T08:00:00+05:30",
  "performer": [
    {
      "reference": "RelatedPerson/attendant-456"
    }
  ],
  "valueQuantity": {
    "value": 72.5,
    "unit": "kg",
    "system": "http://unitsofmeasure.org",
    "code": "kg"
  }
}
```

### 2.2 Blood Glucose (Glucometer)

**LOINC Code:** 2339-0 (Glucose [Mass/volume] in Blood)

```json
{
  "resourceType": "Observation",
  "id": "obs-glucose-12345",
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "2339-0",
        "display": "Glucose [Mass/volume] in Blood"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T07:30:00+05:30",
  "valueQuantity": {
    "value": 110,
    "unit": "mg/dL",
    "system": "http://unitsofmeasure.org",
    "code": "mg/dL"
  },
  "interpretation": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
          "code": "N",
          "display": "Normal"
        }
      ]
    }
  ],
  "component": [
    {
      "code": {
        "coding": [
          {
            "system": "https://carelog.com/fhir/CodeSystem/measurement-context",
            "code": "fasting",
            "display": "Fasting"
          }
        ]
      },
      "valueBoolean": true
    }
  ]
}
```

### 2.3 Body Temperature

**LOINC Code:** 8310-5 (Body temperature)

```json
{
  "resourceType": "Observation",
  "id": "obs-temp-12345",
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8310-5",
        "display": "Body temperature"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T09:15:00+05:30",
  "valueQuantity": {
    "value": 98.6,
    "unit": "°F",
    "system": "http://unitsofmeasure.org",
    "code": "[degF]"
  },
  "bodySite": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "74262004",
        "display": "Oral cavity structure"
      }
    ]
  }
}
```

### 2.4 Blood Pressure

Blood pressure is recorded as a panel with systolic and diastolic components.

**Panel LOINC Code:** 85354-9 (Blood pressure panel with all children optional)
**Systolic LOINC Code:** 8480-6 (Systolic blood pressure)
**Diastolic LOINC Code:** 8462-4 (Diastolic blood pressure)

```json
{
  "resourceType": "Observation",
  "id": "obs-bp-12345",
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "85354-9",
        "display": "Blood pressure panel with all children optional"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T08:30:00+05:30",
  "component": [
    {
      "code": {
        "coding": [
          {
            "system": "http://loinc.org",
            "code": "8480-6",
            "display": "Systolic blood pressure"
          }
        ]
      },
      "valueQuantity": {
        "value": 120,
        "unit": "mmHg",
        "system": "http://unitsofmeasure.org",
        "code": "mm[Hg]"
      }
    },
    {
      "code": {
        "coding": [
          {
            "system": "http://loinc.org",
            "code": "8462-4",
            "display": "Diastolic blood pressure"
          }
        ]
      },
      "valueQuantity": {
        "value": 80,
        "unit": "mmHg",
        "system": "http://unitsofmeasure.org",
        "code": "mm[Hg]"
      }
    }
  ],
  "bodySite": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "368209003",
        "display": "Right upper arm structure"
      }
    ]
  },
  "method": {
    "coding": [
      {
        "system": "http://snomed.info/sct",
        "code": "37931006",
        "display": "Auscultation"
      }
    ]
  }
}
```

### 2.5 Heart Rate / Pulse

**LOINC Code:** 8867-4 (Heart rate)

```json
{
  "resourceType": "Observation",
  "id": "obs-hr-12345",
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "8867-4",
        "display": "Heart rate"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T08:30:00+05:30",
  "valueQuantity": {
    "value": 72,
    "unit": "beats/minute",
    "system": "http://unitsofmeasure.org",
    "code": "/min"
  }
}
```

### 2.6 Oxygen Saturation (SpO2)

**LOINC Code:** 2708-6 (Oxygen saturation in Arterial blood)

```json
{
  "resourceType": "Observation",
  "id": "obs-spo2-12345",
  "status": "final",
  "category": [
    {
      "coding": [
        {
          "system": "http://terminology.hl7.org/CodeSystem/observation-category",
          "code": "vital-signs",
          "display": "Vital Signs"
        }
      ]
    }
  ],
  "code": {
    "coding": [
      {
        "system": "http://loinc.org",
        "code": "2708-6",
        "display": "Oxygen saturation in Arterial blood"
      }
    ]
  },
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "effectiveDateTime": "2026-03-14T08:30:00+05:30",
  "valueQuantity": {
    "value": 98,
    "unit": "%",
    "system": "http://unitsofmeasure.org",
    "code": "%"
  },
  "device": {
    "display": "Pulse Oximeter"
  }
}
```

---

## 3. DocumentReference Resource

Maps CareLog uploaded documents (prescriptions, reports) to FHIR DocumentReference.

### Field Mapping

| CareLog Field | FHIR Path | Notes |
|---------------|-----------|-------|
| documentId | identifier[0].value | UUID |
| patientId | subject.reference | Patient/CL-XXXXXX |
| type | type.coding[0].code | prescription / lab_report / imaging / other |
| title | description | User-provided title |
| s3Key | content[0].attachment.url | Presigned URL or S3 reference |
| uploadedAt | date | ISO 8601 datetime |
| uploadedBy | author[0].reference | Who uploaded |
| mimeType | content[0].attachment.contentType | MIME type |
| fileSize | content[0].attachment.size | Bytes |

### JSON Schema Example

```json
{
  "resourceType": "DocumentReference",
  "id": "doc-12345",
  "meta": {
    "lastUpdated": "2026-03-14T10:00:00Z"
  },
  "identifier": [
    {
      "system": "https://carelog.com/document-id",
      "value": "550e8400-e29b-41d4-a716-446655440000"
    }
  ],
  "status": "current",
  "type": {
    "coding": [
      {
        "system": "https://carelog.com/fhir/CodeSystem/document-type",
        "code": "prescription",
        "display": "Prescription"
      },
      {
        "system": "http://loinc.org",
        "code": "57833-6",
        "display": "Prescription for medication"
      }
    ]
  },
  "category": [
    {
      "coding": [
        {
          "system": "http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category",
          "code": "clinical-note",
          "display": "Clinical Note"
        }
      ]
    }
  ],
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "date": "2026-03-14T10:00:00+05:30",
  "author": [
    {
      "reference": "RelatedPerson/relative-789",
      "display": "Jane Doe (Daughter)"
    }
  ],
  "description": "Dr. Smith - Monthly Prescription March 2026",
  "content": [
    {
      "attachment": {
        "contentType": "application/pdf",
        "url": "https://carelog-documents.s3.amazonaws.com/CL-ABC123/2026/03/14/prescription-march.pdf",
        "size": 245678,
        "title": "prescription-march-2026.pdf",
        "creation": "2026-03-14T10:00:00+05:30"
      }
    }
  ],
  "context": {
    "period": {
      "start": "2026-03-01",
      "end": "2026-03-31"
    }
  }
}
```

### Document Type Codes

| CareLog Type | LOINC Code | Display |
|--------------|------------|---------|
| prescription | 57833-6 | Prescription for medication |
| lab_report | 11502-2 | Laboratory report |
| imaging | 18748-4 | Diagnostic imaging report |
| discharge_summary | 18842-5 | Discharge summary |
| other | 34133-9 | Summary of episode note |

---

## 4. CarePlan Resource

Maps CareLog care reminders and medication schedules to FHIR CarePlan.

### Field Mapping

| CareLog Field | FHIR Path | Notes |
|---------------|-----------|-------|
| planId | identifier[0].value | UUID |
| patientId | subject.reference | Patient/CL-XXXXXX |
| status | status | draft / active / completed |
| title | title | Plan name |
| activities | activity[] | Scheduled activities |
| createdBy | author.reference | Who created the plan |

### JSON Schema Example

```json
{
  "resourceType": "CarePlan",
  "id": "careplan-12345",
  "meta": {
    "lastUpdated": "2026-03-14T10:00:00Z"
  },
  "identifier": [
    {
      "system": "https://carelog.com/careplan-id",
      "value": "cp-550e8400"
    }
  ],
  "status": "active",
  "intent": "plan",
  "category": [
    {
      "coding": [
        {
          "system": "http://hl7.org/fhir/us/core/CodeSystem/careplan-category",
          "code": "assess-plan",
          "display": "Assessment and Plan of Treatment"
        }
      ]
    }
  ],
  "title": "Daily Health Monitoring Plan",
  "description": "Comprehensive daily health monitoring for patient",
  "subject": {
    "reference": "Patient/CL-ABC123"
  },
  "period": {
    "start": "2026-03-01"
  },
  "created": "2026-03-01T08:00:00+05:30",
  "author": {
    "reference": "RelatedPerson/relative-789"
  },
  "activity": [
    {
      "detail": {
        "kind": "ServiceRequest",
        "code": {
          "coding": [
            {
              "system": "http://loinc.org",
              "code": "29463-7",
              "display": "Body weight"
            }
          ]
        },
        "status": "scheduled",
        "scheduledTiming": {
          "repeat": {
            "frequency": 1,
            "period": 1,
            "periodUnit": "d",
            "timeOfDay": ["08:00:00"]
          }
        },
        "description": "Daily morning weight measurement"
      }
    },
    {
      "detail": {
        "kind": "ServiceRequest",
        "code": {
          "coding": [
            {
              "system": "http://loinc.org",
              "code": "85354-9",
              "display": "Blood pressure panel"
            }
          ]
        },
        "status": "scheduled",
        "scheduledTiming": {
          "repeat": {
            "frequency": 2,
            "period": 1,
            "periodUnit": "d",
            "timeOfDay": ["08:00:00", "20:00:00"]
          }
        },
        "description": "Twice daily blood pressure measurement"
      }
    },
    {
      "detail": {
        "kind": "MedicationRequest",
        "code": {
          "coding": [
            {
              "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
              "code": "6809",
              "display": "Metformin"
            }
          ]
        },
        "status": "scheduled",
        "scheduledTiming": {
          "repeat": {
            "frequency": 2,
            "period": 1,
            "periodUnit": "d",
            "when": ["ACM", "ACV"]
          }
        },
        "description": "Metformin 500mg twice daily with meals"
      }
    }
  ]
}
```

---

## 5. LOINC Code Reference

Quick reference for all LOINC codes used in CareLog.

### Vital Signs

| Measurement | LOINC Code | Display Name | Unit |
|-------------|------------|--------------|------|
| Body Weight | 29463-7 | Body weight | kg, lb |
| Blood Glucose | 2339-0 | Glucose [Mass/volume] in Blood | mg/dL |
| Body Temperature | 8310-5 | Body temperature | °F, °C |
| BP Panel | 85354-9 | Blood pressure panel | - |
| Systolic BP | 8480-6 | Systolic blood pressure | mmHg |
| Diastolic BP | 8462-4 | Diastolic blood pressure | mmHg |
| Heart Rate | 8867-4 | Heart rate | /min |
| SpO2 | 2708-6 | Oxygen saturation in Arterial blood | % |

### Document Types

| Document Type | LOINC Code | Display Name |
|---------------|------------|--------------|
| Prescription | 57833-6 | Prescription for medication |
| Lab Report | 11502-2 | Laboratory report |
| Imaging Report | 18748-4 | Diagnostic imaging report |
| Discharge Summary | 18842-5 | Discharge summary |
| General Note | 34133-9 | Summary of episode note |

---

## Appendix A: CareLog Custom Extensions

### Blood Type Extension

```
URL: https://carelog.com/fhir/StructureDefinition/blood-type
Type: string
Values: A+, A-, B+, B-, AB+, AB-, O+, O-, Unknown
```

### Measurement Context Extension

```
URL: https://carelog.com/fhir/StructureDefinition/measurement-context
Type: CodeableConcept
Values: fasting, post-meal, before-medication, after-exercise
```

### Sync Status Extension

```
URL: https://carelog.com/fhir/StructureDefinition/sync-status
Type: code
Values: pending, synced, failed
```

---

## Appendix B: Terminology Bindings

### Observation Category

- System: `http://terminology.hl7.org/CodeSystem/observation-category`
- Values: vital-signs, laboratory, imaging, procedure

### Interpretation

- System: `http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation`
- Common values: L (Low), N (Normal), H (High), LL (Critically Low), HH (Critically High)

### Contact Relationship

- System: `http://terminology.hl7.org/CodeSystem/v2-0131`
- Values: C (Emergency Contact), E (Employer), F (Federal Agency), etc.
