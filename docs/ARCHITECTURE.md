# Amrutam Telemedicine System — Architecture & System Design Specification

**Document Version**: 1.0.0  
**Target Scale**: 100,000 Daily Consultations (~1.15 writes/sec sustained, ~40 writes/sec peak, ~400 reads/sec peak)  
**System SLA**: 99.95% Availability (~4.38 hours downtime/year max)  
**Performance Targets**: p95 Reads < 200ms | p95 Writes < 500ms  
**Compliance Standards**: HIPAA-aligned PHI Protection, Zero-Trust Architecture, OWASP Top 10 Mitigation  

---

## 1. Executive Summary & Capacity Estimation

Amrutam’s telemedicine platform provides digital ayurvedic consultations, connecting patients with certified practitioners. To reliably serve **100,000 daily consultations**, the backend architecture is built with high concurrency, strict write idempotency, sub-second latency, and data integrity at its core.

### Traffic & Storage Projections
* **Daily Consultations**: 100,000 consultations/day
* **Read-to-Write Ratio**: ~10:1 (Browsing doctors, checking availability slots, reading profiles vs. booking/paying)
* **Write Throughput**: 100,000 / 86,400s ≈ **1.16 writes/sec average**, with peak busy hours (4x multiplier) ≈ **40–50 writes/sec**.
* **Read Throughput**: 1,000,000 / 86,400s ≈ **11.6 reads/sec average**, with peak busy hours ≈ **400–500 reads/sec**.
* **Database Growth**:
  * Consultation record + prescription + audit log ≈ ~5 KB per consultation.
  * $100,000 \times 5\text{ KB} = 500\text{ MB/day} \approx 182.5\text{ GB/year}$.
  * Easily managed with PostgreSQL declarative range partitioning and read replicas.

---

## 2. High-Level Architecture & Data Flow (Task 1)

The system adopts a **Modular Monolith with Dependency Injection** architecture, optimized for operational simplicity, low latency, and eventual microservice extraction.

```mermaid
flowchart TD
    subgraph Clients["Client Layer"]
        Web["Web Application (React)"]
        Mobile["Mobile App (Flutter / React Native)"]
        AdminUI["Admin Analytics Dashboard"]
    end

    subgraph Edge["Edge & Security Layer"]
        WAF["Cloudflare WAF / DDoS Protection"]
        LB["NGINX / ALB Ingress (TLS 1.3 Termination)"]
    end

    subgraph AppCluster["Application Tier (Node.js / Express + TSyringe DI)"]
        API1["API Node 1 (Stateless)"]
        API2["API Node 2 (Stateless)"]
        API3["API Node N (Auto-scaled)"]
    end

    subgraph DistributedState["Distributed Cache & Locks"]
        RedisCluster["Redis 7 Cluster<br/>• Idempotency Keys (TTL: 24h)<br/>• Redlock Distributed Mutex<br/>• Doctor Slots Cache<br/>• Rate Limiter"]
    end

    subgraph AsyncWorkers["Async Processing Layer (BullMQ)"]
        Queue["Redis BullMQ Job Queues"]
        Worker1["Notification & Reminder Worker"]
        Worker2["Prescription PDF Generator"]
        Worker3["Audit Log Archival Worker"]
    end

    subgraph DataStorage["Persistence Layer (PostgreSQL 16)"]
        PGPrimary["PostgreSQL 16 Primary (Read/Write)"]
        PGReplica1["PostgreSQL Read Replica 1"]
        PGReplica2["PostgreSQL Read Replica 2"]
    end

    subgraph External["Third-Party Integrations"]
        PGW["Payment Gateway (Razorpay/Stripe)"]
        VideoService["WebRTC / Twilio Video API"]
        S3["AWS S3 / Object Storage (Prescriptions)"]
    end

    Web --> WAF
    Mobile --> WAF
    AdminUI --> WAF
    WAF --> LB
    LB --> API1 & API2 & API3

    API1 & API2 & API3 <--> RedisCluster
    API1 & API2 & API3 -->|Writes| PGPrimary
    API1 & API2 & API3 -->|Reads| PGReplica1 & PGReplica2
    API1 & API2 & API3 --> Queue

    Queue --> Worker1 & Worker2 & Worker3
    Worker1 --> External
    Worker2 --> S3
    PGPrimary -.->|Streaming Replication| PGReplica1 & PGReplica2
```

### Data Flow Lifecycle
1. **Request Ingestion**: Requests pass through Cloudflare WAF (DDoS protection, rate limiting) to the Ingress Load Balancer.
2. **Gateway Processing**: The Express API layer terminates the request, runs Helmet headers, validates CORS, assigns a UUID `X-Request-ID`, and records Prometheus metrics.
3. **Idempotency Gate**: Write requests (`POST /consultations/book`) require an `Idempotency-Key` header. Redis is queried atomically. If the key exists, the cached result is returned immediately.
4. **Distributed Concurrency Lock**: A Redis Redlock mutex is acquired on `slot:${slotId}` to ensure only one user can book a slot at a time.
5. **Persistence**: Transactions are executed on PostgreSQL Primary using ACID isolation.
6. **Async Offloading**: Non-blocking tasks (PDF rendering, WhatsApp/SMS reminders, audit flushing) are enqueued into BullMQ for background worker processing.

---

## 3. High-Concurrency Booking Flow Sequence Diagram (Task 2)

Booking a doctor’s consultation must be completely immune to race conditions (two patients clicking "Book" simultaneously on the same slot) and network retries (patient double-clicking).

```mermaid
sequenceDiagram
    autonumber
    actor Patient
    participant API as API Server (Express)
    participant Idemp as Idempotency Engine (Redis)
    participant Redlock as Redlock (Redis)
    participant DB as PostgreSQL (Primary)
    participant Queue as BullMQ (Async Queue)
    participant Notification as Notification Worker

    Patient->>API: POST /consultations/book<br/>[Header: Idempotency-Key: uuid-v4]<br/>{ slotId, doctorId, patientId }
    
    activate API
    API->>Idemp: SET idempotency:uuid-v4 "IN_FLIGHT" NX EX 120
    alt Idempotency Key Already Exists
        Idemp-->>API: Key exists (returns cached response or 409 IN_FLIGHT)
        API-->>Patient: 200 OK (Cached Response) or 409 Conflict
    else Key Is Fresh
        Idemp-->>API: OK (Lock acquired)
    end

    API->>Redlock: ACQUIRE LOCK lock:slot:{slotId} (TTL: 10s)
    alt Slot Lock Contention (Another patient is booking this slot)
        Redlock-->>API: Lock Failed (Busy)
        API->>Idemp: DEL idempotency:uuid-v4
        API-->>Patient: 409 Conflict ("Slot is currently being reserved by another user")
    else Lock Successfully Acquired
        Redlock-->>API: Lock OK
    end

    Note over API,DB: BEGIN TRANSACTION (SERIALIZABLE or REPEATABLE READ)
    API->>DB: SELECT * FROM availability_slots WHERE id = slotId FOR UPDATE
    alt Slot Status != 'AVAILABLE'
        API->>DB: ROLLBACK
        API->>Redlock: RELEASE LOCK lock:slot:{slotId}
        API->>Idemp: DEL idempotency:uuid-v4
        API-->>Patient: 410 Gone ("Slot already booked")
    else Slot is AVAILABLE
        API->>DB: UPDATE availability_slots SET status = 'BOOKED', version = version + 1 WHERE id = slotId
        API->>DB: INSERT INTO consultations (id, patient_id, doctor_id, slot_id, status) VALUES (...)
        API->>DB: INSERT INTO payments (id, consultation_id, amount, status, idempotency_key) VALUES (...)
        API->>DB: INSERT INTO audit_logs (event_type, actor_id, resource_id, ...) VALUES (...)
        API->>DB: COMMIT TRANSACTION
    end

    API->>Redlock: RELEASE LOCK lock:slot:{slotId}
    API->>Queue: ENQUEUE job "booking-confirmed" { consultationId }
    API->>Idemp: SET idempotency:uuid-v4 { statusCode: 201, body: {...} } EX 86400
    
    API-->>Patient: 201 Created { consultationId, bookingRef, status: "SCHEDULED" }
    deactivate API

    Queue->>Notification: Process "booking-confirmed"
    Notification->>Patient: Send Email & SMS Confirmation with Video Link
```

---

## 4. Entity-Relationship (ER) Diagram (Task 3)

The data model captures all 8 core entities specified in the assessment with strict relational constraints, Foreign Keys, UUID primary keys, and specialized indexing.

```mermaid
erDiagram
    USERS ||--o| PROFILES : "has one"
    USERS ||--o| DOCTORS : "qualifies as"
    USERS ||--o{ CONSULTATIONS : "participates as patient"
    DOCTORS ||--o{ AVAILABILITY_SLOTS : "opens"
    DOCTORS ||--o{ CONSULTATIONS : "conducts"
    AVAILABILITY_SLOTS ||--o| CONSULTATIONS : "reserved by"
    CONSULTATIONS ||--o| PRESCRIPTIONS : "generates"
    CONSULTATIONS ||--o| PAYMENTS : "billed through"
    USERS ||--o{ AUDIT_LOGS : "triggers actions"

    USERS {
        uuid id PK
        string email UK
        string password_hash
        string role "PATIENT | DOCTOR | ADMIN"
        boolean mfa_enabled
        string mfa_secret
        string status "ACTIVE | SUSPENDED"
        timestamp created_at
        timestamp updated_at
    }

    PROFILES {
        uuid id PK
        uuid user_id FK, UK
        string first_name
        string last_name
        string phone
        date date_of_birth
        string gender
        jsonb emergency_contact
        timestamp updated_at
    }

    DOCTORS {
        uuid id PK
        uuid user_id FK, UK
        string license_number UK
        string[] specialties
        decimal consultation_fee
        int experience_years
        text bio
        decimal rating_avg
        int rating_count
        boolean is_verified
    }

    AVAILABILITY_SLOTS {
        uuid id PK
        uuid doctor_id FK
        timestamp start_time
        timestamp end_time
        string status "AVAILABLE | LOCKED | BOOKED"
        int version "Optimistic Locking"
        timestamp lock_expires_at
    }

    CONSULTATIONS {
        uuid id PK
        string booking_reference UK
        uuid patient_id FK
        uuid doctor_id FK
        uuid slot_id FK, UK
        string status "SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED"
        string meeting_link
        text patient_notes
        timestamp created_at
        timestamp updated_at
    }

    PRESCRIPTIONS {
        uuid id PK
        uuid consultation_id FK, UK
        uuid doctor_id FK
        uuid patient_id FK
        text diagnosis
        jsonb medications "Array of {drug, dosage, frequency, duration}"
        text advice
        string digital_signature
        timestamp issued_at
    }

    PAYMENTS {
        uuid id PK
        uuid consultation_id FK
        decimal amount
        string currency
        string status "PENDING | COMPLETED | REFUNDED | FAILED"
        string idempotency_key UK
        string transaction_ref
        timestamp created_at
    }

    AUDIT_LOGS {
        uuid id PK
        string event_type
        uuid actor_id
        string actor_role
        string resource_type
        uuid resource_id
        jsonb diff_changes
        string ip_address
        string user_agent
        timestamp created_at
    }
```

### Critical Database Indexes
* `availability_slots(doctor_id, start_time, status)` — Compound index for sub-5ms slot lookups.
* `consultations(patient_id, status)` & `consultations(doctor_id, status)` — Fast user consultation histories.
* `doctors USING GIN (specialties)` — GIN inverted index for searching doctors by multiple Ayurvedic specialties.
* `audit_logs(created_at, resource_type, resource_id)` — Rapid audit trail reconstruction for compliance.

---

## 5. API Schema & REST Guidelines (Task 4)

The API strictly follows REST principles with resource-oriented URIs, standardized HTTP status codes, and RFC 7807 Problem Details error formats.

### Standard Response Envelope
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 142
  },
  "requestId": "4fa85f64-5717-4562-b3fc-2c963f66afa6",
  "timestamp": "2026-10-30T12:00:00.000Z"
}
```

### RFC 7807 Problem Details Error Envelope
```json
{
  "type": "https://api.amrutam.co.in/errors/slot-already-booked",
  "title": "Conflict",
  "status": 409,
  "detail": "The requested availability slot has already been reserved by another patient.",
  "instance": "/api/v1/consultations/book",
  "requestId": "4fa85f64-5717-4562-b3fc-2c963f66afa6",
  "timestamp": "2026-10-30T12:00:00.000Z"
}
```

---

## 6. Retry & Backoff Strategies (Task 5)

Network partitions, database connection pool exhaustion, and third-party payment gateway outages require robust retry mechanisms.

### Exponential Backoff with Full Jitter
To prevent the **Thundering Herd** problem where multiple failed retries fire at the identical second:

$$\text{Sleep Time} = \text{random}(0, \min(T_{\max}, T_{\text{base}} \times 2^{\text{attempt}}))$$

* $T_{\text{base}} = 100\text{ ms}$
* $T_{\max} = 5,000\text{ ms}$
* $\text{Max Attempts} = 3$ (API calls) or $5$ (Async background workers)

### Circuit Breaker Pattern
External integrations (Payment Gateway, WebRTC Video API, SMS gateway) are wrapped in a Circuit Breaker:
* **Closed**: Normal operations.
* **Open**: If failure rate exceeds 50% over a 30-second rolling window, requests fail fast immediately without hitting the degraded third-party service.
* **Half-Open**: After a 15-second cooldown, probe traffic is allowed through to test recovery.

---

## 7. Data Partitioning & Sharding Strategy (Task 6)

At 100,000 consultations per day, `consultations` and `audit_logs` generate millions of rows annually. Without partitioning, B-tree indexes exceed RAM cache limits, degrading p95 latency.

### 1. Range Partitioning by Time (PostgreSQL Native)
`consultations` and `audit_logs` are partitioned by month on `created_at`:
```sql
CREATE TABLE consultations (
    id UUID NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ...
) PARTITION BY RANGE (created_at);

CREATE TABLE consultations_2026_10 PARTITION OF consultations
    FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');
```
* **Benefit**: Queries filtering for current month consultations perform **partition pruning**, scanning only the active partition.
* **Cold Storage**: Historical partitions (>12 months) are detached, archived to parquet in S3, and queried via Athena/DuckDB for analytics.

### 2. Read/Write Connection Splitting
* **Primary DB**: Serves write operations (`INSERT`, `UPDATE`, `DELETE`) and critical reads inside transactions (`SELECT FOR UPDATE`).
* **Read Replicas (x2)**: Serves doctor search queries, analytics queries, and profile fetches.

---

## 8. Caching & Concurrency Handling (Task 7)

### Caching Architecture (Redis 7)
* **Doctor Profiles & Specialties**: Cached with a 1-hour TTL. Invalidated upon doctor profile update (`cache:doctor:{id}`).
* **Available Slots**: Cached with a 60-second TTL (`cache:slots:doctor:{id}:{date}`). Invalidated immediately upon slot reservation or cancellation.
* **Cache-Aside Pattern**: Read from cache ➔ on miss, read from Read Replica ➔ populate cache.

### Concurrency Handling: Distributed Redlock vs. Optimistic Locking
To prevent double bookings under high load:
1. **Tier 1 — Fast Distributed Mutex (Redis Redlock)**:
   * Key: `lock:slot:{slotId}`
   * TTL: 10,000ms with auto-release
   * Prevents simultaneous request execution at the web application tier.
2. **Tier 2 — Database Atomic Condition (Optimistic Locking & Conditional Update)**:
   ```sql
   UPDATE availability_slots 
   SET status = 'BOOKED', version = version + 1 
   WHERE id = :slotId AND status = 'AVAILABLE';
   ```
   * If `rows_affected == 0`, the transaction aborts and returns HTTP 409 Conflict. This provides defense-in-depth even if Redis were to temporarily fail.

---

## 9. Transaction Management & Sagas (Task 8)

Booking a consultation involves multiple distinct sub-operations:
1. Slot State Transition (`AVAILABLE` ➔ `BOOKED`)
2. Payment Authorization / Capture
3. Consultation Entity Creation
4. Doctor Notification Dispatch

### Orchestrated Saga Pattern with Compensating Transactions
When distributed systems or asynchronous payment gateways are involved, a Saga Orchestrator manages forward progress and compensating rollbacks:

| Step | Action | Compensating Action (On Failure) |
| :--- | :--- | :--- |
| **1. Reserve Slot** | Mark slot `LOCKED` with 10-minute hold | Revert slot to `AVAILABLE` |
| **2. Process Payment** | Charge patient via Payment Gateway | Trigger automatic refund to patient card |
| **3. Confirm Booking** | Set consultation status `SCHEDULED` | Mark consultation `CANCELLED_DUE_TO_FAILURE` |
| **4. Notify Doctor** | Enqueue reminder email/SMS | Enqueue cancellation notification |

If Step 2 or 3 fails, the orchestrator executes the compensating actions in reverse order, ensuring the system returns to a consistent state without orphan locked slots.

---

## 10. Backup & Disaster Recovery (DR) Strategy (Task 9)

### Service Level Objectives
* **Recovery Point Objective (RPO)**: **< 5 minutes** (Maximum tolerable data loss)
* **Recovery Time Objective (RTO)**: **< 30 minutes** (Maximum time to restore service)

### Strategy & Implementation
1. **Continuous WAL Archiving**:
   * PostgreSQL Write-Ahead Logs (WAL) are streamed continuously to Amazon S3 / Google Cloud Storage every 60 seconds using `pgBackRest` or `wal-g`.
   * Enables **Point-In-Time Recovery (PITR)** to any second in the preceding 30 days.
2. **Automated Daily Full Backups**:
   * Full database snapshots taken daily at 02:00 UTC during lowest traffic.
   * Backups encrypted at rest with AES-256 (KMS-managed keys).
3. **Multi-AZ High Availability**:
   * Primary database runs in Availability Zone A.
   * Synchronous standby replica runs in Availability Zone B.
   * Automatic failover via Patroni / AWS RDS Multi-AZ within 60 seconds if Zone A experiences power or network failure.
4. **Periodic DR Drills**:
   * Automated monthly test restoring the latest backup snapshot to an isolated staging environment, running integrity validation scripts to verify data restoration.

