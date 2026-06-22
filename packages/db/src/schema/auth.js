"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditLog = exports.passwordResetTokens = exports.emailVerifications = exports.refreshTokens = exports.sessions = exports.memberships = exports.users = exports.organizations = void 0;
const pg_core_1 = require("drizzle-orm/pg-core");
exports.organizations = (0, pg_core_1.pgTable)('organizations', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    name: (0, pg_core_1.text)('name').notNull(),
    slug: (0, pg_core_1.text)('slug').notNull().unique(),
    settings: (0, pg_core_1.jsonb)('settings').default({}),
    timezone: (0, pg_core_1.text)('timezone').notNull().default('Europe/London'),
    currency: (0, pg_core_1.text)('currency').notNull().default('GBP'),
    country: (0, pg_core_1.text)('country').notNull().default('GB'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.users = (0, pg_core_1.pgTable)('users', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    email: (0, pg_core_1.text)('email').notNull().unique(),
    passwordHash: (0, pg_core_1.text)('password_hash').notNull(),
    emailVerifiedAt: (0, pg_core_1.timestamp)('email_verified_at', { withTimezone: true }),
    status: (0, pg_core_1.text)('status', { enum: ['active', 'suspended', 'deleted'] })
        .notNull()
        .default('active'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.memberships = (0, pg_core_1.pgTable)('memberships', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    organizationId: (0, pg_core_1.uuid)('organization_id')
        .notNull()
        .references(() => exports.organizations.id, { onDelete: 'cascade' }),
    baseRole: (0, pg_core_1.text)('base_role', {
        enum: [
            'system_admin',
            'admin',
            'manager',
            'receptionist',
            'technician',
            'teacher',
            'guardian',
            'student',
        ],
    }).notNull(),
    status: (0, pg_core_1.text)('status', { enum: ['active', 'suspended', 'removed'] })
        .notNull()
        .default('active'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: (0, pg_core_1.timestamp)('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    (0, pg_core_1.uniqueIndex)('memberships_user_org_uidx').on(t.userId, t.organizationId),
    (0, pg_core_1.index)('memberships_user_id_idx').on(t.userId),
    (0, pg_core_1.index)('memberships_org_id_idx').on(t.organizationId),
]);
exports.sessions = (0, pg_core_1.pgTable)('sessions', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull().unique(),
    userAgent: (0, pg_core_1.text)('user_agent'),
    ip: (0, pg_core_1.text)('ip'),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [(0, pg_core_1.index)('sessions_user_id_idx').on(t.userId)]);
exports.refreshTokens = (0, pg_core_1.pgTable)('refresh_tokens', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    sessionId: (0, pg_core_1.uuid)('session_id')
        .notNull()
        .references(() => exports.sessions.id, { onDelete: 'cascade' }),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull().unique(),
    rotatedFromId: (0, pg_core_1.uuid)('rotated_from_id'),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    usedAt: (0, pg_core_1.timestamp)('used_at', { withTimezone: true }),
    revokedAt: (0, pg_core_1.timestamp)('revoked_at', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [(0, pg_core_1.index)('refresh_tokens_user_id_idx').on(t.userId)]);
exports.emailVerifications = (0, pg_core_1.pgTable)('email_verifications', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    usedAt: (0, pg_core_1.timestamp)('used_at', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.passwordResetTokens = (0, pg_core_1.pgTable)('password_reset_tokens', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    userId: (0, pg_core_1.uuid)('user_id')
        .notNull()
        .references(() => exports.users.id, { onDelete: 'cascade' }),
    tokenHash: (0, pg_core_1.text)('token_hash').notNull().unique(),
    expiresAt: (0, pg_core_1.timestamp)('expires_at', { withTimezone: true }).notNull(),
    usedAt: (0, pg_core_1.timestamp)('used_at', { withTimezone: true }),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
});
exports.auditLog = (0, pg_core_1.pgTable)('audit_log', {
    id: (0, pg_core_1.uuid)('id').primaryKey().defaultRandom(),
    organizationId: (0, pg_core_1.uuid)('organization_id').references(() => exports.organizations.id),
    actorId: (0, pg_core_1.uuid)('actor_id').references(() => exports.users.id),
    action: (0, pg_core_1.text)('action').notNull(),
    entity: (0, pg_core_1.text)('entity').notNull(),
    entityId: (0, pg_core_1.text)('entity_id'),
    before: (0, pg_core_1.jsonb)('before'),
    after: (0, pg_core_1.jsonb)('after'),
    requestId: (0, pg_core_1.text)('request_id'),
    ip: (0, pg_core_1.text)('ip'),
    createdAt: (0, pg_core_1.timestamp)('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
    (0, pg_core_1.index)('audit_log_org_id_idx').on(t.organizationId),
    (0, pg_core_1.index)('audit_log_actor_id_idx').on(t.actorId),
    (0, pg_core_1.index)('audit_log_entity_idx').on(t.entity, t.entityId),
]);
//# sourceMappingURL=auth.js.map